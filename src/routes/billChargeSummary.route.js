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

function toRoundedRupees(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function parseDateOnly(value) {
  const raw = cleanString(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateOnly(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function buildMonthlyRanges(startDate, endDate) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || start > end) {
    throw new Error("A valid start_date and end_date are required");
  }

  const ranges = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    if (ranges.length >= 60) {
      throw new Error("Monthly report date range cannot exceed 60 months");
    }

    const monthStart = new Date(cursor);
    const monthEnd = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)
    );
    const rangeStart = monthStart < start ? start : monthStart;
    const rangeEnd = monthEnd > end ? end : monthEnd;

    ranges.push({
      month: new Intl.DateTimeFormat("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(cursor),
      month_number: cursor.getUTCMonth() + 1,
      year: cursor.getUTCFullYear(),
      start_date: formatDateOnly(rangeStart),
      end_date: formatDateOnly(rangeEnd),
    });

    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)
    );
  }

  return ranges;
}

function toMonthlyReportRow(range, totals = {}) {
  const paid = totals?.source_totals?.paid_breakup || {};
  const sourceTotals = totals?.source_totals || {};
  const waterArrear = toRoundedRupees(paid?.water_arrear_charges);
  const sewerArrear = toRoundedRupees(paid?.sewer_arrear_charges);
  const meterArrear = toRoundedRupees(paid?.meter_arrear_charges);
  const otherArrear = toRoundedRupees(paid?.other_charges_arrear);
  const lateFineArrear = toRoundedRupees(paid?.late_fine_arrear);

  return {
    ...range,
    water_charges: toRoundedRupees(paid?.water_charges),
    sewer_charges: toRoundedRupees(paid?.sewer_charges),
    meter_rent: toRoundedRupees(paid?.meter_charges),
    other_amount:
      toRoundedRupees(paid?.other_charges) +
      toRoundedRupees(sourceTotals?.other_transaction_amount),
    application_form_amount: toRoundedRupees(sourceTotals?.form_amount),
    demand_amount: toRoundedRupees(sourceTotals?.demand_amount),
    service_amount: toRoundedRupees(sourceTotals?.service_amount),
    water_arrear: waterArrear,
    sewer_arrear: sewerArrear,
    meter_rent_arrear: meterArrear,
    other_arrear: otherArrear,
    late_fine_arrear: lateFineArrear,
    arrear:
      waterArrear +
      sewerArrear +
      meterArrear +
      otherArrear +
      lateFineArrear,
    advance: toRoundedRupees(totals?.total_new_advance),
    previous_advance: toRoundedRupees(totals?.total_previous_advance),
    balance: toRoundedRupees(totals?.remaining_balance_net),
    total_receipt: toRoundedRupees(sourceTotals?.total_transactions),
    total_receipt_amount: toRoundedRupees(totals?.total_paid),
  };
}

const MONTHLY_TOTAL_FIELDS = [
  "water_charges",
  "sewer_charges",
  "meter_rent",
  "other_amount",
  "application_form_amount",
  "demand_amount",
  "service_amount",
  "water_arrear",
  "sewer_arrear",
  "meter_rent_arrear",
  "other_arrear",
  "late_fine_arrear",
  "arrear",
  "advance",
  "previous_advance",
  "balance",
  "total_receipt",
  "total_receipt_amount",
];

function totalMonthlyRows(rows = []) {
  return MONTHLY_TOTAL_FIELDS.reduce((totals, field) => {
    totals[field] = rows.reduce(
      (sum, row) => sum + toRoundedRupees(row?.[field]),
      0
    );
    return totals;
  }, {});
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

async function createMonthlyBillChargeSummaryHandler(req, reply) {
  try {
    const payload = normalizeBillChargeSummaryPayload(req.body || {});
    const ranges = buildMonthlyRanges(payload.start_date, payload.end_date);
    const rows = [];

    // Keep requests sequential to avoid flooding the payment/billing RPC services
    // when a financial-year or multi-year report is requested.
    for (const range of ranges) {
      const summary = await getBillChargeTransactionSummaryRPC({
        ...payload,
        start_date: range.start_date,
        startDate: range.start_date,
        from_date: range.start_date,
        from: range.start_date,
        end_date: range.end_date,
        endDate: range.end_date,
        to_date: range.end_date,
        to: range.end_date,
      });
      if (!summary?.ok) {
        throw new Error(
          summary?.message || `Failed to fetch summary for ${range.month}`
        );
      }
      rows.push(toMonthlyReportRow(range, summary?.data?.totals || {}));
    }

    return reply.send({
      ok: true,
      data: {
        filters: {
          department_id: payload.department_id || null,
          division_id: payload.division_id || null,
          collection_center_id: payload.collection_center_id || null,
          scheme_id: payload.scheme_id || null,
          start_date: payload.start_date,
          end_date: payload.end_date,
          payment_method: payload.payment_method || null,
        },
        currency: "INR",
        rounded_to_whole_rupees: true,
        months: rows,
        totals: totalMonthlyRows(rows),
      },
    });
  } catch (err) {
    req.log.error({ err }, "monthly-bill-charge-summary-report failed");
    const isValidationError =
      /valid start_date|cannot exceed 60 months/i.test(err?.message || "");
    return reply.code(isValidationError ? 400 : 500).send({
      ok: false,
      message: "Failed to fetch monthly bill charge summary report",
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

  fastify.post(
    "/monthly-bill-charge-summary-report",
    {
      ...authRoute(
        {
          tags: ["Billing Report"],
          body: {
            ...reportBody,
            required: ["start_date", "end_date"],
          },
        },
        "Billing Report"
      ),
    },
    createMonthlyBillChargeSummaryHandler
  );
}

export default fp(routes);
