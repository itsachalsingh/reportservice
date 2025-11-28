import amqp from 'amqplib';
import { randomUUID } from 'crypto';

let conn;
let channel;
let replyQueue;
let consumerStarted = false;
let connectingPromise = null;

const correlationMap = new Map();

const RABBIT_URL = process.env.RABBITMQ_URI;
if (!RABBIT_URL) {
  console.warn('Warning: RABBITMQ_URI is not set. rpcClient will throw on connect().');
}

const VERIFY_TOKEN_QUEUE = 'verify.token.request';
const DAILY_INCOME_REPORT_QUEUE = 'daily.income.report.request';
const REPORT_TIMEOUT_MS = 15000;

const TIMEOUT_MS = 5000;

async function connect() {
  if (!RABBIT_URL) throw new Error('RABBITMQ_URI is not set');

  conn = await amqp.connect(RABBIT_URL, {
    heartbeat: 15,
    clientProperties: { connection_name: 'reportservice-rpc' },
  });

  conn.on('close', handleDisconnect);
  conn.on('error', (err) => {
    console.error('RabbitMQ connection error:', err);
  });

  channel = await conn.createChannel();

  // Assert request queues (durable because they change state / are important)
  await channel.assertQueue(VERIFY_TOKEN_QUEUE, { durable: true });
  await channel.assertQueue(DAILY_INCOME_REPORT_QUEUE, { durable: true });

  // Exclusive, auto-delete reply queue owned by this connection
  const asserted = await channel.assertQueue('', { exclusive: true, autoDelete: true });
  replyQueue = asserted.queue;

  if (!consumerStarted) {
    consumerStarted = true;
    await channel.consume(
      replyQueue,
      (msg) => {
        if (!msg) return;

        const correlationId = msg.properties?.correlationId;
        const entry = correlationMap.get(correlationId);

        const finish = (fn, payload) => {
          if (entry?.timer) clearTimeout(entry.timer);
          correlationMap.delete(correlationId);
          if (entry && fn) fn(payload);
        };

        try {
          const payload = JSON.parse(msg.content.toString());
          finish(entry?.resolve, payload);
        } catch (e) {
          finish(entry?.reject, e);
        }
      },
      { noAck: true }
    );
  }
}

function handleDisconnect() {
  channel = null;
  replyQueue = null;
  consumerStarted = false;

  for (const [id, entry] of correlationMap.entries()) {
    if (entry?.timer) clearTimeout(entry.timer);
    entry?.reject?.(new Error('RabbitMQ connection lost'));
    correlationMap.delete(id);
  }

  reconnectWithBackoff().catch(() => {});
}

async function reconnectWithBackoff() {
  let delay = 1000;
  while (!channel) {
    try {
      await connect();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000);
    }
  }
}

async function doConnect() {
  await connect();
}

async function ensureConnected() {
  if (channel && replyQueue) return;
  if (!connectingPromise) {
    connectingPromise = doConnect().finally(() => { connectingPromise = null; });
  }
  await connectingPromise;
}

export async function connectRPC() {
  await ensureConnected();
}

export async function verifyTokenRPC(token) {
  await ensureConnected();

  return new Promise((resolve, reject) => {
    const correlationId = randomUUID();
    const timer = setTimeout(() => {
      if (correlationMap.has(correlationId)) {
        correlationMap.delete(correlationId);
        reject(new Error('Token verify timeout'));
      }
    }, TIMEOUT_MS);

    correlationMap.set(correlationId, { resolve, reject, timer });

    try {
      channel.sendToQueue(
        VERIFY_TOKEN_QUEUE,
        Buffer.from(JSON.stringify({ token })),
        {
          replyTo: replyQueue,
          correlationId,
          contentType: 'application/json',
          deliveryMode: 1,
        }
      );
    } catch (e) {
      clearTimeout(timer);
      correlationMap.delete(correlationId);
      reject(e);
    }
  });
}

export async function getDailyIncomeReportRPC(input) {
  await ensureConnected();

  const payload = {
    start_date: input?.start_date,
    end_date: input?.end_date,
    collection_center: input?.collection_center || input?.collection_center_id || null,
    division: input?.division || input?.division_id || null,
    department: input?.department || input?.department_id || null,
    payment_methods: input?.payment_methods || input?.payment_method || null,
    types: input?.types || input?.type || null,
    area_type: input?.area_type || null,
  };

  return new Promise((resolve, reject) => {
    const correlationId = randomUUID();
    const timer = setTimeout(() => {
      if (correlationMap.has(correlationId)) {
        correlationMap.delete(correlationId);
        reject(new Error('Daily income report timeout'));
      }
    }, REPORT_TIMEOUT_MS);

    correlationMap.set(correlationId, { resolve, reject, timer });

    try {
      channel.sendToQueue(
        DAILY_INCOME_REPORT_QUEUE,
        Buffer.from(JSON.stringify(payload)),
        {
          replyTo: replyQueue,
          correlationId,
          contentType: 'application/json',
          deliveryMode: 2,
          headers: {
            'x-service': 'reportservice',
            'x-op': 'daily_income_report',
          },
        }
      );
    } catch (e) {
      clearTimeout(timer);
      correlationMap.delete(correlationId);
      reject(e);
    }
  });
}
