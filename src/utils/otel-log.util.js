import { Buffer } from "node:buffer";
import process from "node:process";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const DEFAULT_LOGS_ENDPOINT = "http://192.168.1.100:4318/v1/logs";
const DEFAULT_SERVICE_NAME = "uwbs-reportservice";
const REDACTED = "[REDACTED]";

const SEVERITY_BY_LEVEL = {
  trace: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
};

let initialized = false;
let loggerProvider = null;
let otelLogger = null;
let shutdownPromise = null;

export function sanitizeValue(value, key = "", depth = 0, seen = new WeakSet()) {
  if (/(authorization|cookie|password|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|otp|captcha|signature)/i.test(key)) {
    return REDACTED;
  }
  if (value == null) return value;
  if (depth >= 8) return "[MaxDepth:8]";
  if (typeof value === "string") {
    if (/url|uri/i.test(key)) return value.split(/[?#]/)[0];
    return value.length > 50000 ? `${value.slice(0, 50000)}...[truncated]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return sanitizeValue(
      { name: value.name, message: value.message, code: value.code },
      key,
      depth + 1,
      seen,
    );
  }
  if (Buffer.isBuffer(value)) return { type: "Buffer", length: value.length };
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, "", depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey, depth + 1, seen),
    ]),
  );
}

function resolveLogsEndpoint() {
  if (process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
    return process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  }
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, "");
    return base.endsWith("/v1/logs") ? base : `${base}/v1/logs`;
  }
  return DEFAULT_LOGS_ENDPOINT;
}

function initializeOpenTelemetry() {
  if (initialized) return;
  initialized = true;

  const enabled = process.env.OTEL_LOGS_ENABLED === undefined
    ? process.env.NODE_ENV !== "test"
    : String(process.env.OTEL_LOGS_ENABLED).toLowerCase() === "true";
  if (
    !enabled ||
    process.env.OTEL_SDK_DISABLED?.toLowerCase() === "true" ||
    process.env.OTEL_LOGS_EXPORTER?.toLowerCase() === "none"
  ) return;

  try {
    const serviceName = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
    const attributes = { "service.name": serviceName };
    if (process.env.NODE_ENV) {
      attributes["deployment.environment.name"] = process.env.NODE_ENV;
    }
    const exporter = new OTLPLogExporter({ url: resolveLogsEndpoint() });
    loggerProvider = new LoggerProvider({
      resource: resourceFromAttributes(attributes),
      processors: [new BatchLogRecordProcessor(exporter)],
    });
    logs.setGlobalLoggerProvider(loggerProvider);
    otelLogger = loggerProvider.getLogger(serviceName);
  } catch (error) {
    loggerProvider = null;
    otelLogger = null;
    process.stderr.write(`Failed to start OpenTelemetry logging: ${error?.message || error}\n`);
  }
}

export function emitOpenTelemetryLog(level, event, details = {}, timestamp = Date.now()) {
  initializeOpenTelemetry();
  if (!otelLogger || shutdownPromise) return;

  try {
    const normalized = String(level || "info").toLowerCase();
    const severity = SEVERITY_BY_LEVEL[normalized] ? normalized : "info";
    const eventName = String(event || "app.log").slice(0, 500);
    otelLogger.emit({
      eventName,
      timestamp,
      severityNumber: SEVERITY_BY_LEVEL[severity],
      severityText: severity.toUpperCase(),
      body: { event: eventName, details: sanitizeValue(details) },
      attributes: { "event.name": eventName },
    });
  } catch {
    // Telemetry export must never interrupt application logging.
  }
}

export function shutdownOpenTelemetry() {
  if (!loggerProvider) return Promise.resolve();
  if (!shutdownPromise) shutdownPromise = loggerProvider.shutdown();
  return shutdownPromise;
}

export { DEFAULT_LOGS_ENDPOINT, resolveLogsEndpoint };
