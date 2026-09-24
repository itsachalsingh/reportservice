import process from "node:process";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

const DEFAULT_TRACES_ENDPOINT = "http://192.168.1.100:4318/v1/traces";
const DEFAULT_SERVICE_NAME = "uwbs-reportservice";

let sdk = null;
let startAttempted = false;
let shutdownPromise = null;

class RedactingTraceExporter extends OTLPTraceExporter {
  export(spans, resultCallback) {
    for (const span of spans) {
      for (const [key, value] of Object.entries(span.attributes || {})) {
        if (/(authorization|cookie|password|secret|token|api[-_.]?key|otp|signature)/i.test(key)) {
          span.attributes[key] = "[REDACTED]";
        } else if (/^(db\.statement|db\.query\.text)$/i.test(key)) {
          delete span.attributes[key];
        } else if (typeof value === "string" && /url|uri|target|query/i.test(key)) {
          span.attributes[key] = value.split(/[?#]/)[0];
        }
      }
    }
    super.export(spans, resultCallback);
  }
}

function isTracingEnabled() {
  if (String(process.env.OTEL_SDK_DISABLED || "false").toLowerCase() === "true") return false;
  if (String(process.env.OTEL_TRACES_EXPORTER || "").toLowerCase() === "none") return false;

  const explicitValue = process.env.OTEL_TRACES_ENABLED;
  return explicitValue === undefined
    ? process.env.NODE_ENV !== "test"
    : String(explicitValue).toLowerCase() === "true";
}

function resolveTracesEndpoint() {
  if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  }
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, "");
    return base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
  }
  return DEFAULT_TRACES_ENDPOINT;
}

export function startOpenTelemetryTracing() {
  if (startAttempted) return sdk;
  startAttempted = true;
  if (!isTracingEnabled()) return null;

  try {
    const serviceName = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
    const attributes = { "service.name": serviceName };
    if (process.env.NODE_ENV) {
      attributes["deployment.environment.name"] = process.env.NODE_ENV;
    }
    sdk = new NodeSDK({
      // Logs use a separate redacting provider.
      logRecordProcessors: [],
      resource: resourceFromAttributes(attributes),
      traceExporter: new RedactingTraceExporter({ url: resolveTracesEndpoint() }),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-pino": { disableLogSending: true },
          "@opentelemetry/instrumentation-http": {
            redactedQueryParams: [
              "token",
              "access_token",
              "refresh_token",
              "password",
              "secret",
              "otp",
              "api_key",
              "signature",
            ],
          },
        }),
      ],
    });
    sdk.start();
  } catch (error) {
    sdk = null;
    process.stderr.write(`Failed to start OpenTelemetry tracing: ${error?.message || error}\n`);
  }

  return sdk;
}

export function shutdownOpenTelemetryTracing() {
  if (!sdk) return Promise.resolve();
  if (!shutdownPromise) shutdownPromise = sdk.shutdown();
  return shutdownPromise;
}

export { DEFAULT_TRACES_ENDPOINT, isTracingEnabled, resolveTracesEndpoint };
