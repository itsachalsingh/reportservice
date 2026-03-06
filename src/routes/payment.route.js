import fp from "fastify-plugin";
import { getDailyIncomeReportRPC } from "../utils/rpcClient.js";
import { createDailyIncomePdf } from "../utils/dailyIncomePdf.js";

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
    revenue_unit_id: { type: "string" },
    ledger_id: { type: "string" },
    lane_id: { type: "string" },
    page: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: 500 },
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
    revenue_unit_id: req.body?.revenue_unit_id,
    ledger_id: req.body?.ledger_id,
    lane_id: req.body?.lane_id,
    page: req.body?.page,
    limit: req.body?.limit,
    payment_methods: req.body?.payment_methods || req.body?.payment_method,
    types: req.body?.types || req.body?.type,
    area_type: req.body?.area_type,
  };

  try {
    const rpc = await getDailyIncomeReportRPC(payload);
    return reply.send({ ok: true, data: rpc });
  } catch (err) {
    req.log.error({ err }, "daily-income-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch daily income report",
      error: err?.message || String(err),
    });
  }
}

async function createDailyIncomePdfHandler(req, reply) {
  const payload = {
    start_date: req.body?.start_date,
    end_date: req.body?.end_date,
    collection_center: req.body?.collection_center || req.body?.collection_center_id,
    division: req.body?.division || req.body?.division_id,
    scheme: req.body?.scheme || req.body?.scheme_id,
    department: req.body?.department || req.body?.department_id,
    revenue_unit_id: req.body?.revenue_unit_id,
    ledger_id: req.body?.ledger_id,
    lane_id: req.body?.lane_id,
    page: req.body?.page,
    limit: req.body?.limit,
    payment_methods: req.body?.payment_methods || req.body?.payment_method,
    types: req.body?.types || req.body?.type,
    area_type: req.body?.area_type,
  };

  try {
    const rpc = await getDailyIncomeReportRPC(payload);
    if (!rpc?.ok) {
      return reply.code(500).send({
        ok: false,
        message: rpc?.message || "Failed to fetch daily income report",
        error: rpc?.error || null,
      });
    }

    const reportData = rpc?.data || {};
    const pdf = await createDailyIncomePdf({
      payload,
      summary: reportData?.summary || {},
      details: Array.isArray(reportData?.details) ? reportData.details : [],
      pagination: reportData?.pagination || {},
    });

    const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename=\"daily-income-report-${ts}.pdf\"`
    );
    return reply.send(pdf);
  } catch (err) {
    req.log.error({ err }, "daily-income-report-pdf failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to generate daily income report pdf",
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

  fastify.post(
    "/daily-income-report-pdf",
    {
      ...authRoute(
        {
          tags: ["Income Report"],
          body: dailyIncomeBody,
        },
        "Income Report"
      ),
    },
    createDailyIncomePdfHandler
  );
}

export default fp(routes);
