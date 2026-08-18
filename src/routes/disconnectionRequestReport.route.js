import fp from 'fastify-plugin';
import { getDisconnectionReportRPC } from '../utils/rpcClient.js';

const statusEnum = ['All', 'Approved', 'Rejected', 'Pending', 'Draft', 'Processing'];
const reportBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    department: { type: 'string' },
    department_id: { type: 'string' },
    division: { type: 'string' },
    division_id: { type: 'string' },
    collection_center: { type: 'string' },
    collection_center_id: { type: 'string' },
    scheme: { type: 'string' },
    scheme_id: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    status: { type: 'string', enum: statusEnum },
    page: { type: 'integer', minimum: 1, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
  },
};

async function disconnectionRequestReportHandler(request, reply) {
  try {
    const result = await getDisconnectionReportRPC(request.body || {});
    if (!result?.ok) {
      return reply.code(400).send({ ok: false, message: result?.message || 'Invalid report filters' });
    }
    return reply.send({ ok: true, ...result.data });
  } catch (error) {
    request.log.error({ err: error }, 'disconnection-request-report failed');
    return reply.code(502).send({
      ok: false,
      message: 'Failed to fetch disconnection requests from formservice',
      error: error?.message || String(error),
    });
  }
}

async function routes(fastify, opts) {
  fastify.post(
    '/disconnection-request-report',
    {
      ...opts.authRoute({
        tags: ['Consumer Report'],
        summary: 'Monthly disconnection request total and list',
        body: reportBody,
      }, 'Consumer Report'),
    },
    disconnectionRequestReportHandler,
  );
}

export default fp(routes);
