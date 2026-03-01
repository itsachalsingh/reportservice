import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { cachedJson } from "../utils/cache.js";

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
    from: { type: "string", format: "date" },
    to: { type: "string", format: "date" },
    bill_month: { type: "string" },
    billMonth: { type: "string" },
    month: { type: "string" },
    group_by_division: { type: "boolean" },
    groupByDivision: { type: "boolean" },
    group_by_collection_center: { type: "boolean" },
    groupByCollectionCenter: { type: "boolean" },
    group_by_scheme: { type: "boolean" },
    groupByScheme: { type: "boolean" },
  },
};

const DAY_TTL_SECONDS = 24 * 60 * 60;
const REPORT_CACHE_TTL_SECONDS = Number(
  process.env.BILL_AMOUNT_BREAKUP_CACHE_TTL_SECONDS || DAY_TTL_SECONDS
);

function toNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTtl(ttl) {
  const parsed = Number(ttl);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toBreakupResponse(summary = {}) {
  const data = summary?.data || {};
  const totalArrearFallback =
    toNum(data?.total_water_arrear_rounded_rupees) +
    toNum(data?.total_sewer_arrear_rounded_rupees) +
    toNum(data?.total_other_arrear_rounded_rupees) +
    toNum(data?.total_meter_rent_arrear_rounded_rupees) +
    toNum(data?.total_late_fine_rounded_rupees);

  return {
    total_bill_generated_count: toNum(data?.total_bill_generated_count),
    total_amount: toNum(data?.total_bill_generated_value_rounded_rupees),
    total_collected_amount: toNum(data?.total_bill_collected_rounded_rupees),
    total_water_charges: toNum(data?.total_water_charges_rounded_rupees),
    total_sewer_charges: toNum(data?.total_sewer_charges_rounded_rupees),
    total_other_charges: toNum(data?.total_other_charges_rounded_rupees),
    total_meter_rent: toNum(data?.total_meter_rent_rounded_rupees),
    total_water_arrear: toNum(data?.total_water_arrear_rounded_rupees),
    total_sewer_arrear: toNum(data?.total_sewer_arrear_rounded_rupees),
    total_other_arrear: toNum(data?.total_other_arrear_rounded_rupees),
    total_meter_rent_arrear: toNum(data?.total_meter_rent_arrear_rounded_rupees),
    total_late_fine: toNum(data?.total_late_fine_rounded_rupees),
    total_arrear: toNum(data?.total_arrear_rounded_rupees) || totalArrearFallback,
    total_advance: toNum(data?.total_advance_rounded_rupees),
  };
}

async function createBillAmountBreakupSummaryHandler(req, reply) {
  try {
    const body = req.body || {};
    const payload = {
      ...body,
      group_by_division: false,
      group_by_collection_center: false,
      group_by_scheme: false,
    };

    const ttl = normalizeTtl(REPORT_CACHE_TTL_SECONDS);
    const scope = `${req.user?.id || req.user?._id || ""}:${req.user?.role_id || ""}`;

    const summary = ttl
      ? (
          await cachedJson({
            prefix: "report:bill-amount-breakup:v1",
            keyPayload: { payload, scope },
            ttlSeconds: ttl,
            loader: () => fetchBillCollectionSummary(payload),
            log: req.log,
          })
        ).value
      : await fetchBillCollectionSummary(payload);

    return reply.send({
      ok: true,
      data: {
        filters: summary?.filters || {},
        totals: toBreakupResponse(summary),
      },
    });
  } catch (err) {
    req.log.error({ err }, "bill-amount-breakup-summary-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch bill amount breakup summary report",
      error: err?.message || String(err),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/bill-amount-breakup-summary-report",
    {
      ...authRoute(
        {
          tags: ["Billing Report"],
          body: reportBody,
        },
        "Billing Report"
      ),
    },
    createBillAmountBreakupSummaryHandler
  );
}

export default fp(routes);
