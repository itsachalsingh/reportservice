import {
  getBillChargeTransactionSummaryRPC,
  getDailyIncomeReportRPC,
} from "../utils/rpcClient.js";
import { createDailyIncomePdf } from "../utils/dailyIncomePdf.js";
import { getConnectionByConsumerCode } from "../utils/grpc/connectionClient.js";
import { getDivisionById } from "../utils/grpc/divisionClient.js";

export const paymentModes = [
  "cash",
  "card",
  "online",
  "upi",
  "demand draft",
  "cheque",
  "offline",
  "all",
];

export const transactionTypes = ["form", "bill", "service", "demand", "all"];
export const transactionStatuses = [
  "pending",
  "completed",
  "failed",
  "dishonor",
  "cancelled",
  "canceled",
  "all",
];

export function normalizeTransactionTypes(input = {}) {
  const rawTypes = input?.types ?? input?.type;

  if (Array.isArray(rawTypes)) {
    const types = rawTypes
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);

    if (!types.length || types.includes("all")) return "all";
    return types;
  }

  if (rawTypes === undefined || rawTypes === null) return null;

  const type = String(rawTypes).trim();
  return type || "all";
}

function parsePositiveInt(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function reportMoney(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function allocateReportAmount(row = {}, amount = 0) {
  let remaining = reportMoney(amount);
  const allocated = {};
  const charges = [
    ["late_fee", "late_fee"],
    ["water_arrear", "water_arrear"],
    ["sewer_arrear", "sewer_arrear"],
    ["meter_rent_arrear", "meter_rent_arrear"],
    ["other_arrear", "other_arrear"],
    ["late_fee_arrear", "late_fee_arrear"],
    ["water_charges", "water_charges"],
    ["sewer_charges", "sewer_charges"],
    ["meter_rent", "meter_rent"],
    ["others", "others"],
  ];

  for (const [target, source] of charges) {
    const due = Math.max(0, reportMoney(row?.[source]));
    const paid = Math.min(Math.max(0, remaining), due);
    allocated[target] = paid;
    remaining -= paid;
  }
  allocated.excess_amount = Math.max(0, remaining);
  return allocated;
}

function subtractAllocation(current = {}, previous = {}) {
  const result = {};
  for (const key of Object.keys(current)) {
    result[key] = Math.max(
      0,
      reportMoney(current?.[key]) - reportMoney(previous?.[key])
    );
  }
  return result;
}

// The payment RPC enriches every transaction with its bill's full breakup. For
// partial/multiple payments that repeats the same demand on every PDF row. Turn
// those bill-level values into transaction-level allocations, using the same
// charge priority as the MPR summary.
export function allocateDailyIncomePdfDetails(details = []) {
  if (!Array.isArray(details) || !details.length) return details;

  const output = details.map((row) => ({ ...row }));
  const groups = new Map();
  output.forEach((row, index) => {
    if (String(row?.type || "").toLowerCase() !== "bill") return;
    const billNumber = firstText(row?.bill_number, row?.billNumber);
    if (!billNumber) return;
    if (!groups.has(billNumber)) groups.set(billNumber, []);
    groups.get(billNumber).push({ row, index });
  });

  for (const items of groups.values()) {
    items.sort((a, b) => {
      const aTime = new Date(a.row?.transaction_date || 0).getTime();
      const bTime = new Date(b.row?.transaction_date || 0).getTime();
      return aTime - bTime || a.index - b.index;
    });

    const bill = items[0].row;
    const hasPartialPayment = items.some(
      ({ row }) => row?.is_partial_payment === true || row?.isPartialPayment === true
    );
    const dueTime = new Date(bill?.due_date || bill?.dueDate || 0).getTime();
    const lastPaymentTime = Math.max(
      ...items.map(({ row }) => new Date(row?.transaction_date || 0).getTime())
    );
    const rawRebate = reportMoney(bill?.discount);
    const hasUsableDates =
      Number.isFinite(dueTime) &&
      dueTime > 0 &&
      Number.isFinite(lastPaymentTime) &&
      lastPaymentTime > 0;
    const rebate =
      !hasPartialPayment &&
      (!hasUsableDates || lastPaymentTime <= dueTime + 86_399_999)
        ? rawRebate
        : 0;
    const previousAdvance = reportMoney(
      bill?.previous_advance ?? bill?.adv_wb_chrg ?? bill?.advanceused
    );

    let cumulativePaid = 0;
    let previousAllocation = {};
    items.forEach(({ row, index }, itemIndex) => {
      cumulativePaid += reportMoney(row?.paid_amount ?? row?.amount);
      const cumulativeAllocation = allocateReportAmount(
        bill,
        cumulativePaid + rebate + previousAdvance
      );
      const allocation = subtractAllocation(cumulativeAllocation, previousAllocation);
      previousAllocation = cumulativeAllocation;

      const arrears =
        allocation.water_arrear +
        allocation.sewer_arrear +
        allocation.meter_rent_arrear +
        allocation.other_arrear +
        allocation.late_fee_arrear;
      const chargeTotal =
        allocation.water_charges +
        allocation.sewer_charges +
        allocation.meter_rent +
        allocation.others +
        allocation.late_fee +
        arrears;

      output[index] = {
        ...row,
        ...allocation,
        arrears,
        bill_amount: chargeTotal,
        discount: itemIndex === 0 ? rebate : 0,
        previous_advance: itemIndex === 0 ? previousAdvance : 0,
        adv_wb_chrg: itemIndex === 0 ? previousAdvance : 0,
      };
    });
  }

  return output;
}

export function buildPdfTotalsFromBillChargeSummary(totals = {}) {
  const paid = totals?.source_totals?.paid_breakup || {};
  const source = totals?.source_totals || {};
  const water = reportMoney(paid?.water_charges);
  const sewer = reportMoney(paid?.sewer_charges);
  const meter = reportMoney(paid?.meter_charges);
  const other =
    reportMoney(paid?.other_charges) +
    reportMoney(source?.other_transaction_amount);
  const late = reportMoney(paid?.fine);
  const disc = reportMoney(totals?.total_discount);
  const arrears =
    reportMoney(paid?.water_arrear_charges) +
    reportMoney(paid?.sewer_arrear_charges) +
    reportMoney(paid?.meter_arrear_charges) +
    reportMoney(paid?.other_charges_arrear) +
    reportMoney(paid?.late_fine_arrear);

  return {
    water,
    sewer,
    meter,
    other,
    late,
    disc,
    arrears,
    total: water + sewer + meter + other + late + arrears,
    paid: reportMoney(totals?.total_paid),
    previousAdvance: reportMoney(totals?.total_previous_advance),
    advance: reportMoney(totals?.total_new_advance),
    balance: reportMoney(totals?.remaining_balance_net),
  };
}

export const PDF_FETCH_LIMIT = Math.max(
  1,
  Math.min(500, Number(process.env.DAILY_INCOME_PDF_FETCH_LIMIT) || 500)
);

export const PDF_FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.DAILY_INCOME_PDF_FETCH_CONCURRENCY) || 2
);

export const PDF_RPC_TIMEOUT_MS = Math.max(
  1,
  Number(process.env.DAILY_INCOME_PDF_RPC_TIMEOUT_MS) || 60000
);

export const EXPORT_JOB_RPC_TIMEOUT_MS = Math.max(
  PDF_RPC_TIMEOUT_MS,
  Number(process.env.DAILY_INCOME_EXPORT_JOB_RPC_TIMEOUT_MS) || 180000
);

export const PDF_QUERY_MAX_TIME_MS = parsePositiveInt(
  process.env.DAILY_INCOME_PDF_QUERY_MAX_TIME_MS,
  null
);

export const EXPORT_JOB_QUERY_MAX_TIME_MS = parsePositiveInt(
  process.env.DAILY_INCOME_EXPORT_QUERY_MAX_TIME_MS,
  PDF_QUERY_MAX_TIME_MS
);

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (!text) continue;
    return text;
  }
  return null;
}

function isObjectIdLike(value) {
  return /^[a-f0-9]{24}$/i.test(String(value ?? "").trim());
}

function firstDisplayText(...values) {
  for (const value of values) {
    const text = firstText(value);
    if (!text || text.toLowerCase() === "all" || isObjectIdLike(text)) continue;
    return text;
  }
  return null;
}

function firstObjectId(...values) {
  for (const value of values) {
    const text = firstText(value);
    if (text && isObjectIdLike(text)) return text;
  }
  return null;
}

export function buildDailyIncomePayload(input = {}) {
  return {
    start_date: input?.start_date || input?.fromDate,
    end_date: input?.end_date || input?.toDate,
    report_title: input?.report_title || null,
    collection_center:
      input?.collection_center ||
      input?.collection_center_id ||
      input?.collectionCenter ||
      null,
    division: input?.division || input?.division_id || null,
    scheme: input?.scheme || input?.scheme_id || null,
    department: input?.department || input?.department_id || null,
    department_name: input?.department_name || null,
    revenue_unit_id: input?.revenue_unit_id || null,
    ledger_id: input?.ledger_id || null,
    lane_id: input?.lane_id || null,
    page: input?.page,
    limit: input?.limit,
    payment_methods: input?.payment_methods || input?.payment_method || null,
    types: normalizeTransactionTypes(input),
    service_type: input?.service_type || input?.serviceType || null,
    status: input?.status || input?.transaction_status || null,
    area_type: input?.area_type || null,
  };
}

export async function enrichDetailsWithConnectionAddress(details = []) {
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

async function resolveDivisionNameById(divisionId) {
  if (!divisionId) return null;

  try {
    const response = await getDivisionById(divisionId);
    return firstDisplayText(response?.division?.name);
  } catch {
    return null;
  }
}

async function enrichDetailsWithDivisionNames(details = []) {
  if (!Array.isArray(details) || !details.length) return details;

  const enriched = details.map((row) => ({ ...row }));
  const divisionIds = [
    ...new Set(
      enriched
        .map((row) => firstObjectId(row?.division_id, row?.division))
        .filter(Boolean)
    ),
  ];

  if (!divisionIds.length) return enriched;

  const entries = await Promise.all(
    divisionIds.map(async (divisionId) => [
      divisionId,
      await resolveDivisionNameById(divisionId),
    ])
  );
  const namesById = new Map(entries.filter(([, name]) => Boolean(name)));

  for (const row of enriched) {
    const divisionId = firstObjectId(row?.division_id, row?.division);
    const divisionName = divisionId ? namesById.get(divisionId) : null;
    if (divisionName) row.division = divisionName;
  }

  return enriched;
}

async function resolveSelectedDivisionHeaderForPdf(payload = {}, summary = {}) {
  const filters = summary?.filters || {};
  const displayName = firstDisplayText(
    payload?.division_name,
    filters?.division_name,
    payload?.division,
    filters?.division
  );
  if (displayName) return displayName;

  const selectedDivisionId = firstObjectId(
    payload?.division_id,
    payload?.division,
    filters?.division
  );
  if (selectedDivisionId) {
    const selectedDivisionName = await resolveDivisionNameById(selectedDivisionId);
    if (selectedDivisionName) return selectedDivisionName;
  }

  return null;
}

async function resolvePdfHeaderContext(payload = {}, summary = {}) {
  const divisionName = await resolveSelectedDivisionHeaderForPdf(payload, summary);

  if (!divisionName) return payload;

  return {
    ...payload,
    division_name: divisionName,
  };
}

export async function fetchDailyIncomeReportForPdf(
  basePayload = {},
  options = {}
) {
  const pageSize = PDF_FETCH_LIMIT;
  const rpcTimeoutMs = parsePositiveInt(
    options?.rpcTimeoutMs,
    PDF_RPC_TIMEOUT_MS
  );
  const queryMaxTimeMs = parsePositiveInt(
    options?.queryMaxTimeMs,
    PDF_QUERY_MAX_TIME_MS
  );
  const rpcOptions = { timeoutMs: rpcTimeoutMs };

  const firstRpc = await getDailyIncomeReportRPC(
    {
      ...basePayload,
      page: 1,
      limit: pageSize,
      ...(queryMaxTimeMs ? { max_time_ms: queryMaxTimeMs } : {}),
    },
    rpcOptions
  );

  if (!firstRpc?.ok) return firstRpc;

  const firstData = firstRpc?.data || {};
  const firstDetails = Array.isArray(firstData?.details)
    ? firstData.details
    : [];
  const firstPagination = firstData?.pagination || {};
  const totalPages = Math.max(
    Number(firstPagination?.total_pages) || 1,
    1
  );

  if (totalPages <= 1) {
    return {
      ...firstRpc,
      data: {
        ...firstData,
        details: allocateDailyIncomePdfDetails(firstDetails),
        pagination: {
          ...firstPagination,
          page: 1,
          limit: pageSize,
        },
      },
    };
  }

  const remainingResponses = new Array(totalPages - 1);
  const concurrency = Math.min(PDF_FETCH_CONCURRENCY, totalPages - 1);
  let nextPage = 2;
  let failedRpc = null;

  const worker = async () => {
    while (!failedRpc && nextPage <= totalPages) {
      const currentPage = nextPage;
      nextPage += 1;

      const rpc = await getDailyIncomeReportRPC(
        {
          ...basePayload,
          page: currentPage,
          limit: pageSize,
          include_summary: false,
          include_total: false,
          resolve_location_names: false,
          ...(queryMaxTimeMs ? { max_time_ms: queryMaxTimeMs } : {}),
        },
        rpcOptions
      );

      if (!rpc?.ok) {
        failedRpc = rpc;
        return;
      }

      remainingResponses[currentPage - 2] = rpc;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (failedRpc) return failedRpc;

  const remainingDetails = remainingResponses.flatMap((rpc) =>
    Array.isArray(rpc?.data?.details) ? rpc.data.details : []
  );

  return {
    ...firstRpc,
    data: {
      ...firstData,
      details: allocateDailyIncomePdfDetails([
        ...firstDetails,
        ...remainingDetails,
      ]),
      pagination: {
        ...firstPagination,
        page: 1,
        limit: pageSize,
        total_pages: totalPages,
        total:
          Number(firstPagination?.total) ||
          firstDetails.length + remainingDetails.length,
      },
    },
  };
}

export async function generateDailyIncomePdfBuffer(payload, options = {}) {
  const rpc = await fetchDailyIncomeReportForPdf(payload, options);
  if (!rpc?.ok) {
    const err = new Error(
      rpc?.message || "Failed to fetch daily income report"
    );
    err.details = rpc?.error || null;
    throw err;
  }

  const reportData = rpc?.data || {};
  const billChargeSummary = await getBillChargeTransactionSummaryRPC(
    {
      ...payload,
      status: "completed",
      transaction_status: "completed",
    },
    { timeoutMs: options?.rpcTimeoutMs || PDF_RPC_TIMEOUT_MS }
  );
  if (!billChargeSummary?.ok) {
    throw new Error(
      billChargeSummary?.message ||
        "Failed to fetch the authoritative bill charge totals for PDF"
    );
  }
  const detailTotalsOverride = buildPdfTotalsFromBillChargeSummary(
    billChargeSummary?.data?.totals || {}
  );
  const addressEnrichedDetails = await enrichDetailsWithConnectionAddress(
    Array.isArray(reportData?.details) ? reportData.details : []
  );
  const enrichedDetails = await enrichDetailsWithDivisionNames(addressEnrichedDetails);
  const pdfPayload = await resolvePdfHeaderContext(
    payload,
    reportData?.summary || {}
  );

  const pdf = await createDailyIncomePdf({
    payload: pdfPayload,
    summary: reportData?.summary || {},
    details: enrichedDetails,
    pagination: reportData?.pagination || {},
    detailTotalsOverride,
  });

  return {
    pdf,
    reportData: {
      ...reportData,
      details: enrichedDetails,
    },
    totalRecords:
      Number(reportData?.pagination?.total) || enrichedDetails.length || 0,
  };
}
