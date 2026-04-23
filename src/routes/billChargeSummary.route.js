import fp from "fastify-plugin";
import { getBillChargeTransactionSummaryRPC } from "../utils/rpcClient.js";

const reportBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    department: { type: "string" },
    department_id: { type: "string" },
    departmentId: { type: "string" },
    division: { type: "string" },
    division_id: { type: "string" },
    divisionId: { type: "string" },
    collection_center: { type: "string" },
    collection_center_id: { type: "string" },
    collectionCenter: { type: "string" },
    collectionCenterId: { type: "string" },
    scheme: { type: "string" },
    scheme_id: { type: "string" },
    schemeId: { type: "string" },
    revenue_unit_id: { type: "string" },
    revenueUnitId: { type: "string" },
    ledger_id: { type: "string" },
    ledgerId: { type: "string" },
    lane_id: { type: "string" },
    laneId: { type: "string" },
    district: { type: "string" },
    area_type: { type: "string", enum: ["urban", "rural", "all"] },
    areaType: { type: "string", enum: ["urban", "rural", "all"] },
    ward: { type: "string" },
    village: { type: "string" },
    start_date: { type: "string", format: "date" },
    end_date: { type: "string", format: "date" },
    from_date: { type: "string", format: "date" },
    to_date: { type: "string", format: "date" },
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" },
    fromDate: { type: "string", format: "date" },
    toDate: { type: "string", format: "date" },
    from: { type: "string", format: "date" },
    to: { type: "string", format: "date" },
    payment_method: { type: "string" },
    payment_methods: {
      oneOf: [
        { type: "array", items: { type: "string" }, minItems: 0 },
        { type: "string" },
        { type: "null" },
      ],
    },
    status: { type: "string" },
    transaction_status: { type: "string" },
    transactionStatus: { type: "string" },
  },
};

function cleanString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function normalizeBillChargeSummaryPayload(body = {}) {
  const departmentId = firstNonEmpty(
    body.department_id,
    body.departmentId,
    body.department
  );
  const divisionId = firstNonEmpty(
    body.division_id,
    body.divisionId,
    body.division
  );
  const startDate = firstNonEmpty(
    body.start_date,
    body.startDate,
    body.from_date,
    body.fromDate,
    body.from
  );
  const endDate = firstNonEmpty(
    body.end_date,
    body.endDate,
    body.to_date,
    body.toDate,
    body.to
  );
  const collectionCenterId = firstNonEmpty(
    body.collection_center_id,
    body.collectionCenterId,
    body.collection_center,
    body.collectionCenter
  );
  const schemeId = firstNonEmpty(body.scheme_id, body.schemeId, body.scheme);

  return {
    ...body,
    department_id: departmentId,
    departmentId,
    division_id: divisionId,
    divisionId,
    collection_center_id: collectionCenterId,
    collectionCenterId: collectionCenterId,
    scheme_id: schemeId,
    schemeId,
    area_type: firstNonEmpty(body.area_type, body.areaType),
    start_date: startDate,
    startDate,
    from_date: startDate,
    from: startDate,
    end_date: endDate,
    endDate,
    to_date: endDate,
    to: endDate,
    revenue_unit_id: firstNonEmpty(body.revenue_unit_id, body.revenueUnitId),
    ledger_id: firstNonEmpty(body.ledger_id, body.ledgerId),
    lane_id: firstNonEmpty(body.lane_id, body.laneId),
  };
}

async function createBillChargeSummaryHandler(req, reply) {
  try {
    const payload = normalizeBillChargeSummaryPayload(req.body || {});
    const summary = await getBillChargeTransactionSummaryRPC(payload);
    if (!summary?.ok) {
      throw new Error(summary?.message || "Failed to fetch bill charge transaction summary");
    }
    const data = summary?.data || {};

    return reply.send({
      ok: true,
      data: {
        filters: {
          ...(data?.filters || {}),
          department_id: payload.department_id || data?.filters?.department || null,
          division_id: payload.division_id || data?.filters?.division || null,
          start_date: payload.start_date || data?.filters?.start_date || null,
          end_date: payload.end_date || data?.filters?.end_date || null,
        },
        totals: data?.totals || {},
      },
    });
  } catch (err) {
    req.log.error({ err }, "bill-charge-summary-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch bill charge summary report",
      error: err?.message || String(err),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/bill-charge-summary-report",
    {
      ...authRoute(
        {
          tags: ["Billing Report"],
          body: reportBody,
        },
        "Billing Report"
      ),
    },
    createBillChargeSummaryHandler
  );
}

export default fp(routes);
