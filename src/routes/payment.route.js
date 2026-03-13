import fp from "fastify-plugin";
import { getDailyIncomeReportRPC } from "../utils/rpcClient.js";
import { createDailyIncomePdf } from "../utils/dailyIncomePdf.js";
import { getConnectionByConsumerCode } from "../utils/grpc/connectionClient.js";

const paymentModes = ["cash", "card", "online", "upi", "demand draft", "cheque", "offline", "all"];
const transactionTypes = ["form", "bill", "service", "demand", "all"];

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (!text) continue;
    return text;
  }
  return null;
}

async function enrichDetailsWithConnectionAddress(details = []) {
  if (!Array.isArray(details) || !details.length) return details;

  const enriched = details.map((row) => ({ ...row }));
  const byConsumerCode = new Map();

  for (const row of enriched) {
    const code = firstText(
      row?.consumer_number,
      row?.consumer_code,
      row?.consumerCode
    );
    if (!code) continue;
    if (!byConsumerCode.has(code)) byConsumerCode.set(code, []);
    byConsumerCode.get(code).push(row);
  }

  const codes = Array.from(byConsumerCode.keys());
  if (!codes.length) return enriched;

  const configured = Number(process.env.PDF_ADDRESS_ENRICH_CONCURRENCY || 8);
  const concurrency = Math.max(
    1,
    Math.min(codes.length, Number.isFinite(configured) ? configured : 8)
  );
  let cursor = 0;

  const worker = async () => {
    while (cursor < codes.length) {
      const idx = cursor;
      cursor += 1;
      const code = codes[idx];
      const rows = byConsumerCode.get(code) || [];
      const needsAddress = rows.some(
        (r) => !firstText(r?.address, r?.consumer_address)
      );
      const needsFatherName = rows.some(
        (r) => !firstText(r?.father_name, r?.fatherName, r?.f_name)
      );
      if (!needsAddress && !needsFatherName) continue;

      try {
        const response = await getConnectionByConsumerCode(code);
        const address = firstText(response?.connection?.connection_address);
        const fatherName = firstText(
          response?.connection?.father_name,
          response?.connection?.fatherName,
          response?.connection?.f_name
        );
        rows.forEach((row) => {
          if (address) {
            row.address = row.address || address;
            row.consumer_address = row.consumer_address || address;
          }
          if (fatherName) {
            row.father_name = row.father_name || fatherName;
            row.fatherName = row.fatherName || fatherName;
          }
        });
      } catch {
        // Best-effort enrichment for PDF; ignore lookup failures.
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return enriched;
}

async function fetchDailyIncomeReportForPdf(basePayload = {}) {
  const pageSize = Math.min(
    500,
    Math.max(1, Number(basePayload?.limit) || 500)
  );

  const firstRpc = await getDailyIncomeReportRPC({
    ...basePayload,
    page: 1,
    limit: pageSize,
  });

  if (!firstRpc?.ok) return firstRpc;

  const firstData = firstRpc?.data || {};
  const firstDetails = Array.isArray(firstData?.details) ? firstData.details : [];
  const firstPagination = firstData?.pagination || {};
  const totalPages = Math.max(Number(firstPagination?.total_pages) || 1, 1);

  if (totalPages <= 1) {
    return {
      ...firstRpc,
      data: {
        ...firstData,
        details: firstDetails,
        pagination: {
          ...firstPagination,
          page: 1,
          limit: pageSize,
        },
      },
    };
  }

  const remainingResponses = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      getDailyIncomeReportRPC({
        ...basePayload,
        page: index + 2,
        limit: pageSize,
      })
    )
  );

  for (const rpc of remainingResponses) {
    if (!rpc?.ok) return rpc;
  }

  const remainingDetails = remainingResponses.flatMap((rpc) =>
    Array.isArray(rpc?.data?.details) ? rpc.data.details : []
  );

  return {
    ...firstRpc,
    data: {
      ...firstData,
      details: [...firstDetails, ...remainingDetails],
      pagination: {
        ...firstPagination,
        page: 1,
        limit: pageSize,
        total_pages: totalPages,
        total: Number(firstPagination?.total) || firstDetails.length + remainingDetails.length,
      },
    },
  };
}

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
    const rpc = await fetchDailyIncomeReportForPdf(payload);
    if (!rpc?.ok) {
      return reply.code(500).send({
        ok: false,
        message: rpc?.message || "Failed to fetch daily income report",
        error: rpc?.error || null,
      });
    }

    const reportData = rpc?.data || {};
    const enrichedDetails = await enrichDetailsWithConnectionAddress(
      Array.isArray(reportData?.details) ? reportData.details : []
    );

    const pdf = await createDailyIncomePdf({
      payload,
      summary: reportData?.summary || {},
      details: enrichedDetails,
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
