import "dotenv/config";
import { register } from "node:module";

// Register ESM instrumentation before loading Fastify and database modules.
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const { startOpenTelemetryTracing, shutdownOpenTelemetryTracing } = await import("./utils/otel-trace.util.js");
startOpenTelemetryTracing();

try {
  await import("./utils/logging.js");
  await import("./index.js");
} catch (error) {
  console.error("Reportservice startup failed", error);
  const { shutdownOpenTelemetry } = await import("./utils/otel-log.util.js");
  await Promise.allSettled([shutdownOpenTelemetry(), shutdownOpenTelemetryTracing()]);
  process.exit(1);
}
