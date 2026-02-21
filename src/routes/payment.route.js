import fp from "fastify-plugin";
import { getDailyIncomeReportRPC } from "../utils/rpcClient.js";

const paymentModes = ["cash", "card", "online", "upi", "demand draft", "cheque", "all"];
const transactionTypes = ["form", "bill", "service", "demand", "all"];

const dailyIncomeBody = {
  type: "object",
  required: ["start_date", "end_date"],
  additionalProperties: false,
  properties: {
    start_date: { type: "string", format: "date" },
    end_date: { type: "string", format: "date" },
    collection_center: { type: "string" },
    collection_center_id: { type: "string" },
    division: { type: "string" },
    division_id: { type: "string" },
    scheme: { type: "string" },
    scheme_id: { type: "string" },
    department: { type: "string" },
    department_id: { type: "string" },
    area_type: { type: "string", enum: ["urban", "rural", "all"] },
    payment_methods: {
      oneOf: [
        { type: "array", items: { type: "string", enum: paymentModes }, minItems: 0 },
        { type: "string", enum: paymentModes },
        { type: "null" },
      ],
    },
    payment_method: {
      anyOf: [
        { type: "string", enum: paymentModes },
        { type: "null" },
      ],
    },
    types: {
      oneOf: [
        { type: "array", items: { type: "string", enum: transactionTypes }, minItems: 1 },
        { type: "string", enum: transactionTypes },
      ],
    },
    type: { type: "string", enum: transactionTypes },
  },
};

async function createDailyIncomeHandler(req, reply) {
  const payload = {
    start_date: req.body?.start_date,
    end_date: req.body?.end_date,
    collection_center: req.body?.collection_center || req.body?.collection_center_id,
    division: req.body?.division || req.body?.division_id,
    scheme: req.body?.scheme || req.body?.scheme_id,
    department: req.body?.department || req.body?.department_id,
    payment_methods: req.body?.payment_methods || req.body?.payment_method,
    types: req.body?.types || req.body?.type,
    area_type: req.body?.area_type,
  };

  try {
    const data = await getDailyIncomeReportRPC(payload);
    return reply.send({ ok: true, data });
  } catch (err) {
    req.log.error({ err }, "daily-income-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch daily income report",
      error: err?.message || String(err),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/daily-income-report",
    {
      ...authRoute(
        {
          tags: ["Income Report"],
          body: dailyIncomeBody,
        },
        "Income Report"
      ),
    },
    createDailyIncomeHandler
  );
}

export default fp(routes);
