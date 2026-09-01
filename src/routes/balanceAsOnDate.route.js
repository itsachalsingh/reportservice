import fp from "fastify-plugin";
import { fetchBalanceAsOnDate } from "../utils/grpc/balanceAsOnDateClient.js";

const bodySchema = {
  type: "object",
  required: ["as_on_date"],
  properties: {
    as_on_date: { type: "string", format: "date" },
    group_by: { type: "string", enum: ["collection_center", "division", "scheme"] },
    department_id: { type: "string" }, division_id: { type: "string" },
    collection_center_id: { type: "string" }, scheme_id: { type: "string" },
  },
};

async function routes(fastify, opts) {
  fastify.post("/balance-as-on-date-report", {
    ...opts.authRoute({ tags: ["Billing Report"], body: bodySchema }, "Billing Report"),
  }, async (req, reply) => {
    try {
      const data = await fetchBalanceAsOnDate(req.body || {});
      return reply.send({ ok: true, data });
    } catch (error) {
      req.log.error({ error }, "balance-as-on-date-report failed");
      return reply.code(500).send({ ok: false, message: error?.details || error?.message || "Failed to fetch report" });
    }
  });
}

export default fp(routes);
