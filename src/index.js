import Fastify from "fastify";
import multipart from "@fastify/multipart";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectRPC } from "./utils/rpcClient.js";
import authPlugin from "./plugins/auth.js";
import masterRoutes from "./routes/master.routes.js";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import ajvErrors from "ajv-errors";
import formbody from '@fastify/formbody';
import sanitizePlugin from "./plugins/sanitize.js";
import DailyIncomePdfJob from "./models/dailyIncomePdfJob.model.js";
import { resumePendingDailyIncomePdfJobs } from "./services/dailyIncomePdfJob.service.js";
import { logStream } from "./utils/logging.js";
import { shutdownOpenTelemetry } from "./utils/otel-log.util.js";
import { shutdownOpenTelemetryTracing } from "./utils/otel-trace.util.js";

dotenv.config();

const fastify = Fastify({
  logger: { stream: logStream },
  ajv: {
    customOptions: {
      allErrors: true,
    },
    plugins: [[ajvErrors, { singleError: true }]],
  },
});

fastify.register(multipart, { attachFieldsToBody: true });
await fastify.register(formbody);

let shuttingDown = false;

async function stopTelemetry() {
  const results = await Promise.allSettled([
    shutdownOpenTelemetry(),
    shutdownOpenTelemetryTracing(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      process.stderr.write(`Failed to shut down OpenTelemetry: ${result.reason?.message || result.reason}\n`);
    }
  }
}

async function close(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  let exitCode = 0;

  fastify.log.info({ signal }, "Shutting down reportservice");
  try {
    await fastify.close();
    await mongoose.disconnect();
  } catch (error) {
    exitCode = 1;
    fastify.log.error({ err: error, signal }, "Reportservice shutdown failed");
  }

  await stopTelemetry();
  process.exit(exitCode);
}

process.on("SIGINT", () => close("SIGINT"));
process.on("SIGTERM", () => close("SIGTERM"));

async function start() {
  try {
    await fastify.register(swagger, {
      swagger: {
        info: { title: "Report Service API", version: "1.0.0" },
        securityDefinitions: {
          bearerAuth: {
            type: "apiKey",
            name: "Authorization",
            in: "header",
            description:
              "Paste only your JWT token here (UI will add 'Bearer ' automatically).",
          },
        },
        security: [{ bearerAuth: [] }],
        tags: [{ name: "Reports" }],
      },
    });

    await fastify.register(swaggerUI, {
      routePrefix: "/docs",
      exposeRoute: true,
    });

    await fastify.register(authPlugin);
    await fastify.register(sanitizePlugin);
    await fastify.register(masterRoutes, { prefix: "/api" });

    // await errorHandler(fastify);
    await mongoose.connect(process.env.MONGO_URI);
    // Ensure indexes exist (non-blocking)
    try { DailyIncomePdfJob.syncIndexes().catch(() => {}); } catch {}

    await connectRPC();
    await resumePendingDailyIncomePdfJobs(fastify.log);

    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`reportservice running on :${port}`);
  } catch (err) {
    fastify.log.error(err);
    await stopTelemetry();
    process.exit(1);
  }
}

start();

