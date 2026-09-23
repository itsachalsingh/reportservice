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

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : 0;
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
