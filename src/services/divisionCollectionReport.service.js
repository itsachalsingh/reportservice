export const DIVISION_COLLECTION_NUMERIC_FIELDS = [
  "total_bills",
  "pending_bills",
  "total_unpaid_bills",
  "total_amount",
  "total_current_amount",
  "total_old_arrear_amount",
  "total_collection",
  "online_payments",
  "offline_payments",
  "csc",
  "bbps",
  "payu",
  "sabpaisa",
  "mwipe",
  "razorpay",
];

function cleanString(value) {
  return value == null ? "" : String(value).trim();
}

function optionalFilter(value) {
  const cleaned = cleanString(value);
  return cleaned.toLowerCase() === "all" ? "" : cleaned;
}

export function normalizeDivisionCollectionFilters(input = {}) {
  const paymentGateway =
    input?.payment_gateway ?? input?.paymentGateway ?? input?.gateway;
  const paymentStatus =
    input?.payment_status ??
    input?.paymentStatus ??
    input?.transaction_status ??
    input?.transactionStatus ??
    input?.status;

  return {
    department_id: optionalFilter(
      input?.department_id || input?.departmentId || input?.department
    ),
    division_id: optionalFilter(
      input?.division_id || input?.divisionId || input?.division
    ),
    collection_center_id: optionalFilter(
      input?.collection_center_id ||
        input?.collectionCenterId ||
        input?.collection_center ||
        input?.collectionCenter
    ),
    scheme_id: optionalFilter(
      input?.scheme_id || input?.schemeId || input?.scheme
    ),
    area_type: optionalFilter(input?.area_type || input?.areaType).toLowerCase(),
    billing_cycle: optionalFilter(
      input?.billing_cycle ||
        input?.billingCycle ||
        input?.bill_cycle ||
        input?.billCycle
    ),
    payment_gateway: Array.isArray(paymentGateway)
      ? paymentGateway
          .map(optionalFilter)
          .filter(Boolean)
      : optionalFilter(paymentGateway),
    // Preserve an explicit "all": the payment service uses it to remove its
    // default completed-only restriction. An omitted status remains completed.
    payment_status: cleanString(paymentStatus).toLowerCase(),
  };
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function rowKey(row = {}) {
  return cleanString(row?.division_id || row?.id || row?._id) || "__unassigned__";
}

function emptyRow(divisionId = "", divisionName = "") {
  return {
    division_id: cleanString(divisionId),
    division_name: cleanString(divisionName) || "Unassigned",
    ...Object.fromEntries(DIVISION_COLLECTION_NUMERIC_FIELDS.map((field) => [field, 0])),
  };
}

function parseDateOnly(value) {
  const match = cleanString(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function istDateOnly(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Invalid current date");
  return new Date(parsed.getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function addDateOnlyDays(value, days) {
  const parsed = parseDateOnly(value);
  if (!parsed) return null;
  const date = new Date(`${parsed}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes"].includes(cleanString(value).toLowerCase());
}

export function resolveDivisionCollectionPeriods(input = {}, now = new Date()) {
  const today = istDateOnly(now);
  const defaultEndDate = booleanValue(input?.include_today ?? input?.includeToday)
    ? today
    : addDateOnlyDays(today, -1);
  const requestedStart = cleanString(
    input?.start_date ||
      input?.startDate ||
      input?.date_from ||
      input?.dateFrom ||
      input?.from_date ||
      input?.from
  );
  const requestedEnd = cleanString(
    input?.end_date ||
      input?.endDate ||
      input?.date_to ||
      input?.dateTo ||
      input?.to_date ||
      input?.to ||
      input?.as_on_date ||
      input?.asOnDate
  );
  const financialYear = cleanString(
    input?.financial_year || input?.financialYear || input?.fy
  );

  let financialYearStart = "";
  let financialYearEnd = "";
  if (financialYear) {
    const match = financialYear.match(/^(\d{4})(?:\s*[-/]\s*(\d{2}|\d{4}))?$/);
    if (!match) throw new Error("financial_year must look like 2025-26 or 2025-2026");
    const startYear = Number(match[1]);
    const expectedEndYear = startYear + 1;
    if (match[2]) {
      const suppliedEndYear =
        match[2].length === 2
          ? Math.floor(startYear / 100) * 100 + Number(match[2])
          : Number(match[2]);
      if (suppliedEndYear !== expectedEndYear) {
        throw new Error("financial_year must span one April-to-March cycle");
      }
    }
    financialYearStart = `${startYear}-04-01`;
    financialYearEnd = `${expectedEndYear}-03-31`;
  }

  const parsedStart = requestedStart ? parseDateOnly(requestedStart) : "";
  const parsedEnd = requestedEnd ? parseDateOnly(requestedEnd) : "";
  if (requestedStart && !parsedStart) {
    throw new Error("start_date must use YYYY-MM-DD format");
  }
  if (requestedEnd && !parsedEnd) {
    throw new Error("end_date must use YYYY-MM-DD format");
  }

  let endDate = parsedEnd || financialYearEnd || defaultEndDate;
  if (endDate > today) {
    if (parsedEnd) throw new Error("end_date cannot be in the future");
    endDate = defaultEndDate;
  }

  const endYear = Number(endDate.slice(0, 4));
  const endMonth = Number(endDate.slice(5, 7));
  const defaultStartYear = endMonth >= 4 ? endYear : endYear - 1;
  const startDate =
    parsedStart || financialYearStart || `${defaultStartYear}-04-01`;

  if (startDate > endDate) throw new Error("start_date cannot be after end_date");

  return {
    start_date: startDate,
    end_date: endDate,
    cutoff_date: endDate,
    includes_today: endDate === today,
    periods: [
      {
        label: `${startDate} to ${endDate}`,
        start_date: startDate,
        end_date: endDate,
      },
    ],
  };
}

export function buildDivisionCollectionScopes({
  billingRows = [],
  masterDivisions = [],
} = {}) {
  const scopes = new Map();

  const add = (division, preferName = false, allowUnassigned = false) => {
    const divisionId = cleanString(
      division?.division_id || division?.divisionId || division?.id || division?._id
    );
    const divisionName = cleanString(
      division?.division_name || division?.divisionName || division?.name
    );
    const key =
      divisionId ||
      (divisionName ? `name:${divisionName.toLowerCase()}` : "") ||
      (allowUnassigned ? "__unassigned__" : "");
    if (!key) return;

    const current = scopes.get(key) || {};
    const billNumbers = new Set(current.bill_numbers || []);
    for (const value of Array.isArray(division?.bill_numbers)
      ? division.bill_numbers
      : Array.isArray(division?.billNumbers)
        ? division.billNumbers
        : []) {
      const billNumber = cleanString(value);
      if (billNumber) billNumbers.add(billNumber);
    }
    scopes.set(key, {
      division_id:
        divisionId || current.division_id || (allowUnassigned ? "__unassigned__" : ""),
      division_name:
        (preferName ? divisionName : current.division_name) ||
        divisionName ||
        current.division_name ||
        "",
      bill_numbers: [...billNumbers],
    });
  };

  for (const row of Array.isArray(billingRows) ? billingRows : []) add(row, false, true);
  for (const division of Array.isArray(masterDivisions) ? masterDivisions : []) {
    add(division, true);
  }

  return [...scopes.values()];
}

export function mergeDivisionCollectionRows({
  billingRows = [],
  paymentRows = [],
  masterDivisions = [],
} = {}) {
  const rowsByDivision = new Map();

  for (const division of Array.isArray(masterDivisions) ? masterDivisions : []) {
    const id = cleanString(division?.id || division?._id || division?.division_id);
    if (!id) continue;
    rowsByDivision.set(id, emptyRow(id, division?.name || division?.division_name));
  }

  for (const billing of Array.isArray(billingRows) ? billingRows : []) {
    const key = rowKey(billing);
    const current = rowsByDivision.get(key) || emptyRow(
      billing?.division_id,
      billing?.division_name
    );
    rowsByDivision.set(key, {
      ...current,
      division_id: cleanString(billing?.division_id),
      division_name:
        cleanString(current?.division_name) !== "Unassigned"
          ? current.division_name
          : cleanString(billing?.division_name) || "Unassigned",
      total_bills: number(billing?.total_bills),
      pending_bills: number(billing?.pending_bills),
      total_unpaid_bills: number(billing?.total_unpaid_bills),
      total_amount: number(billing?.total_amount),
      total_current_amount: number(billing?.total_current_amount),
      total_old_arrear_amount: number(billing?.total_old_arrear_amount),
    });
  }

  for (const payment of Array.isArray(paymentRows) ? paymentRows : []) {
    const key = rowKey(payment);
    const current = rowsByDivision.get(key) || emptyRow(payment?.division_id);
    rowsByDivision.set(key, {
      ...current,
      total_collection: number(payment?.total_collection),
      online_payments: number(payment?.online_payments),
      offline_payments: number(payment?.offline_payments),
      csc: number(payment?.csc),
      bbps: number(payment?.bbps),
      payu: number(payment?.payu),
      sabpaisa: number(payment?.sabpaisa),
      mwipe: number(payment?.mwipe),
      razorpay: number(payment?.razorpay),
    });
  }

  return [...rowsByDivision.values()].sort((a, b) =>
    a.division_name.localeCompare(b.division_name) ||
    a.division_id.localeCompare(b.division_id)
  );
}

export function buildDivisionCollectionTotals(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (totals, row) => {
      for (const field of DIVISION_COLLECTION_NUMERIC_FIELDS) {
        totals[field] = number(totals[field] + number(row?.[field]));
      }
      return totals;
    },
    Object.fromEntries(DIVISION_COLLECTION_NUMERIC_FIELDS.map((field) => [field, 0]))
  );
}

export function toDivisionCollectionSpreadsheetRow(row = {}) {
  return {
    "Division Name": cleanString(row?.division_name) || "Unassigned",
    "Total Bills": number(row?.total_bills),
    "Pending Bills": number(row?.pending_bills),
    "Total Unpaid Bills": number(row?.total_unpaid_bills),
    "Total Amount": number(row?.total_amount),
    "Total Current Amount": number(row?.total_current_amount),
    "Total Old Arrear Amount in previous bill": number(
      row?.total_old_arrear_amount
    ),
    "Total Collection": number(row?.total_collection),
    "Online Payments": number(row?.online_payments),
    "Offline Payments": number(row?.offline_payments),
    CSC: number(row?.csc),
    BBPS: number(row?.bbps),
    PayU: number(row?.payu),
    Sabpaisa: number(row?.sabpaisa),
    mwipe: number(row?.mwipe),
    Razorpay: number(row?.razorpay),
  };
}
