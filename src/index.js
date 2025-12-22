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

dotenv.config();

const fastify = Fastify({
  logger: true,
  ajv: {
    customOptions: {
      allErrors: true,
    },
    plugins: [[ajvErrors, { singleError: true }]],
  },
});

fastify.register(multipart, { attachFieldsToBody: true });
await fastify.register(formbody);


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
    try { Transaction.syncIndexes().catch(() => {}); } catch {}

    await connectRPC();

    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`reportservice running on :${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();

