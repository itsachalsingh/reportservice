import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

function containingPaths(value, needle, path = "root") {
  if (typeof value === "string") return value.includes(needle) ? [path] : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    containingPaths(nested, needle, `${path}.${key}`),
  );
}

test("exports correlated HTTP traces and redacted logs", async () => {
  const net = await import("node:net");
  const reservation = net.createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));

  process.env.OTEL_TRACES_ENABLED = "true";
  process.env.OTEL_LOGS_ENABLED = "true";
  process.env.OTEL_SDK_DISABLED = "false";
  process.env.OTEL_TRACES_EXPORTER = "otlp";
  process.env.OTEL_LOGS_EXPORTER = "otlp";
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${port}/v1/traces`;
  process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = `http://127.0.0.1:${port}/v1/logs`;

  const tracing = await import("./otel-trace.util.js");
  tracing.startOpenTelemetryTracing();
  const http = await import("node:http");
  const batches = { "/v1/traces": [], "/v1/logs": [] };
  const collector = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (batches[request.url]) {
        batches[request.url].push(JSON.parse(Buffer.concat(chunks).toString()));
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise((done) => collector.listen(port, "127.0.0.1", done));

  const { default: Fastify } = await import("fastify");
  const { logStream } = await import("./logging.js");
  const { shutdownOpenTelemetry } = await import("./otel-log.util.js");
  const app = Fastify({ logger: { stream: logStream } });

  try {
    app.get("/report-telemetry-smoke", async (request) => {
      request.log.info({ password: "test-secret" }, "report telemetry marker");
      return { ok: true };
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    await new Promise((done, reject) => {
      http.get(
        `http://127.0.0.1:${app.server.address().port}/report-telemetry-smoke?token=test-secret`,
        (response) => {
          response.resume();
          response.on("end", done);
        },
      ).on("error", reject);
    });
    await app.close();
    await shutdownOpenTelemetry();
    await tracing.shutdownOpenTelemetryTracing();

    const spans = batches["/v1/traces"].flatMap((batch) =>
      batch.resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
    );
    const records = batches["/v1/logs"].flatMap((batch) =>
      batch.resourceLogs.flatMap((resource) =>
        resource.scopeLogs.flatMap((scope) => scope.logRecords),
      ),
    );
    const marker = records.find((record) => JSON.stringify(record).includes("report telemetry marker"));

    assert.ok(spans.some((span) => span.kind === 2), "Missing HTTP server span");
    assert.ok(marker?.traceId, "Missing trace context on Fastify log");
    assert.ok(spans.some((span) => span.traceId === marker.traceId), "Log/trace IDs do not match");
    assert.ok(JSON.stringify(batches).includes("uwbs-reportservice"), "Wrong service name");
    assert.ok(JSON.stringify(records).includes("[REDACTED]"), "Missing log redaction");
    assert.deepEqual(containingPaths(batches, "test-secret"), [], "Secret found in exported telemetry");
  } finally {
    await app.close();
    await Promise.allSettled([shutdownOpenTelemetry(), tracing.shutdownOpenTelemetryTracing()]);
    collector.closeAllConnections?.();
    await new Promise((done) => collector.close(done));
  }
});
