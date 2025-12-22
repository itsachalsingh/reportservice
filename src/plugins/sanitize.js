import fp from "fastify-plugin";
import { sanitizeDeep } from "../utils/sanitize.js";

export default fp(async function sanitizePlugin(fastify) {
  fastify.addHook("preValidation", async (req) => {
    const url = (req.raw?.url || req.url || "").split("?")[0];
    if (url.startsWith("/docs")) return;
    if (req.routeOptions?.config?.skipSanitize) return;
    if (req.isMultipart && req.isMultipart()) return;

    if (req.body && typeof req.body === "object") {
      req.body = sanitizeDeep(req.body);
    }
    if (req.query && typeof req.query === "object") {
      req.query = sanitizeDeep(req.query);
    }
    if (req.params && typeof req.params === "object") {
      req.params = sanitizeDeep(req.params);
    }
  });
});
