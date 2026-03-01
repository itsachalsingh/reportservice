import crypto from "crypto";
import Redis from "ioredis";

const CACHE_ENABLED = String(process.env.REDIS_CACHE_ENABLED || "true").toLowerCase() !== "false";
const REDIS_URL = String(process.env.REDIS_URL || process.env.REDIS_URI || "").trim();
const REDIS_CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1500);
const REDIS_COMMAND_TIMEOUT_MS = Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 1000);
const REDIS_RETRY_COOLDOWN_MS = Number(process.env.REDIS_RETRY_COOLDOWN_MS || 10000);

const localCache = new Map();
const inFlight = new Map();

let redisClient = null;
let nextRedisRetryAt = 0;

function stableSerialize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => stableSerialize(item));
  if (typeof value !== "object") return value;

  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = stableSerialize(value[key]);
  }
  return out;
}

function toKey(prefix, keyPayload) {
  const normalized = stableSerialize(keyPayload);
  const raw = JSON.stringify(normalized);
  const hash = crypto.createHash("sha1").update(raw).digest("hex");
  return `${prefix}:${hash}`;
}

function readLocal(key) {
  const entry = localCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    localCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeLocal(key, value, ttlSeconds) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
  localCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

async function getRedisClient(log) {
  if (!CACHE_ENABLED || !REDIS_URL) return null;
  if (Date.now() < nextRedisRetryAt) return null;

  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    });
    redisClient.on("error", () => {});
  }

  if (redisClient.status !== "ready") {
    try {
      await redisClient.connect();
    } catch (err) {
      nextRedisRetryAt = Date.now() + REDIS_RETRY_COOLDOWN_MS;
      log?.warn?.({ err }, "cache redis connect failed; using local cache");
      return null;
    }
  }

  return redisClient;
}

export async function cachedJson({
  prefix,
  keyPayload,
  ttlSeconds = 60,
  loader,
  log = null,
}) {
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    const value = await loader();
    return { value, cache: "disabled" };
  }

  const key = toKey(prefix, keyPayload);

  const localRaw = readLocal(key);
  if (localRaw != null) {
    return { value: JSON.parse(localRaw), cache: "local" };
  }

  const redis = await getRedisClient(log);
  if (redis) {
    try {
      const redisRaw = await redis.get(key);
      if (redisRaw != null) {
        writeLocal(key, redisRaw, ttl);
        return { value: JSON.parse(redisRaw), cache: "redis" };
      }
    } catch (err) {
      log?.warn?.({ err }, "cache redis read failed");
    }
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    const value = await loader();
    try {
      const raw = JSON.stringify(value);
      writeLocal(key, raw, ttl);
      if (redis) {
        await redis.set(key, raw, "EX", ttl);
      }
    } catch (err) {
      log?.warn?.({ err }, "cache write failed");
    }
    return { value, cache: "miss" };
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

