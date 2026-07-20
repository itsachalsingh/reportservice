import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { getDivisionsByDepartment } from "../utils/grpc/divisionClient.js";
import { getCollectionCenters } from "../utils/grpc/collectionCenterClient.js";
import { getSchemeById, getSchemes } from "../utils/grpc/schemeClient.js";
import { createBillAmountBreakupSummaryPdf } from "../utils/billAmountBreakupSummaryPdf.js";

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
    startMonth: { type: "string" },
    endMonth: { type: "string" },
    startYear: { type: "string" },
    endYear: { type: "string" },
    group_by_division: { type: "boolean" },
    groupByDivision: { type: "boolean" },
    group_by_collection_center: { type: "boolean" },
    groupByCollectionCenter: { type: "boolean" },
    group_by_scheme: { type: "boolean" },
    groupByScheme: { type: "boolean" },
    sort_by: { type: "string" },
    sortBy: { type: "string" },
    sort_order: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    sortOrder: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    page: { type: "integer", minimum: 1 },
    page_size: { type: "integer", minimum: 1, maximum: 1000 },
    pageSize: { type: "integer", minimum: 1, maximum: 1000 },
    division_sort_by: { type: "string" },
    divisionSortBy: { type: "string" },
    division_sort_order: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    divisionSortOrder: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    division_page: { type: "integer", minimum: 1 },
    divisionPage: { type: "integer", minimum: 1 },
    division_page_size: { type: "integer", minimum: 1, maximum: 1000 },
    divisionPageSize: { type: "integer", minimum: 1, maximum: 1000 },
    collection_center_sort_by: { type: "string" },
    collectionCenterSortBy: { type: "string" },
    collection_center_sort_order: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    collectionCenterSortOrder: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    collection_center_page: { type: "integer", minimum: 1 },
    collectionCenterPage: { type: "integer", minimum: 1 },
    collection_center_page_size: { type: "integer", minimum: 1, maximum: 1000 },
    collectionCenterPageSize: { type: "integer", minimum: 1, maximum: 1000 },
    scheme_sort_by: { type: "string" },
    schemeSortBy: { type: "string" },
    scheme_sort_order: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    schemeSortOrder: { type: "string", enum: ["asc", "desc", "ASC", "DESC"] },
    scheme_page: { type: "integer", minimum: 1 },
    schemePage: { type: "integer", minimum: 1 },
    scheme_page_size: { type: "integer", minimum: 1, maximum: 1000 },
    schemePageSize: { type: "integer", minimum: 1, maximum: 1000 },
  },
};

function toNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const asInt = Math.floor(parsed);
  return asInt > 0 ? asInt : fallback;
}

function normalizeSortOrder(value, fallback = "desc") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "asc" || raw === "desc") return raw;
  return fallback;
}

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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthIndex(value) {
  const raw = cleanString(value).toLowerCase();
  if (!raw) return -1;
  return MONTHS.findIndex((month) => month.toLowerCase() === raw);
}

function normalizeYear(value) {
  const raw = cleanString(value);
  return /^\d{4}$/.test(raw) ? Number(raw) : 0;
}

function normalizeMonthRangePayload(body = {}) {
  const startMonthIndex = monthIndex(body.startMonth);
  const endMonthIndex = monthIndex(body.endMonth);
  const startYear = normalizeYear(body.startYear);
  const endYear = normalizeYear(body.endYear || body.startYear);

  if (startMonthIndex < 0 || endMonthIndex < 0 || !startYear || !endYear) {
    return { ...body };
  }

  const billMonth = `${MONTHS[startMonthIndex]} ${startYear} - ${MONTHS[endMonthIndex]} ${endYear}`;
  return {
    ...body,
    bill_month: firstNonEmpty(body.bill_month, body.billMonth, body.month, billMonth),
    billMonth: firstNonEmpty(body.billMonth, body.bill_month, body.month, billMonth),
  };
}

function toBreakupResponse(summary = {}) {
  const data = summary?.data || {};
  const totalBillGeneratedCount = toNum(data?.total_bill_generated_count);
  const remainingBillGeneratedCount = toNum(data?.remaining_bill_generated_count);
  const totalBillPaidCount =
    data?.total_bill_paid_count != null
      ? toNum(data?.total_bill_paid_count)
      : Math.max(totalBillGeneratedCount - remainingBillGeneratedCount, 0);
  const totalArrearFallback =
    toNum(data?.total_water_arrear_rounded_rupees) +
    toNum(data?.total_sewer_arrear_rounded_rupees) +
    toNum(data?.total_other_arrear_rounded_rupees) +
    toNum(data?.total_meter_rent_arrear_rounded_rupees) +
    toNum(data?.total_late_fee_arrear_rounded_rupees) +
    toNum(data?.total_late_fine_rounded_rupees);
  const totalAdvance =
    toNum(data?.total_advance_rounded_rupees) +
    toNum(data?.total_advance_used_rounded_rupees);

  return {
    total_bill_generated_count: totalBillGeneratedCount,
    total_bill_paid_count: totalBillPaidCount,
    total_bill_cancelled_count: toNum(data?.total_bill_cancelled_count),
    total_bill_cancelled_amount: toNum(
      data?.total_bill_cancelled_amount_rounded_rupees ??
        data?.total_bill_cancelled_amount
    ),
    total_bill_waived_off_count: toNum(data?.total_bill_waived_off_count),
    total_bill_waived_off_amount: toNum(
      data?.total_bill_waived_off_amount_rounded_rupees ??
        data?.total_bill_waived_off_amount
    ),
    total_bill_wavied_off_count: toNum(data?.total_bill_waived_off_count),
    total_bill_wavied_off_amount: toNum(
      data?.total_bill_waived_off_amount_rounded_rupees ??
        data?.total_bill_waived_off_amount
    ),
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
    total_late_fine_arrear: toNum(data?.total_late_fee_arrear_rounded_rupees),
    total_late_fine: toNum(data?.total_late_fine_rounded_rupees),
    total_discount: toNum(data?.total_discount_rounded_rupees),
    total_arrear: toNum(data?.total_arrear_rounded_rupees) || totalArrearFallback,
    total_advance: totalAdvance,
    waterPaid: toNum(data?.total_water_paid_rounded_rupees),
    meterPaid: toNum(data?.total_meter_paid_rounded_rupees),
    sewerPaid: toNum(data?.total_sewer_paid_rounded_rupees),
    otherPaid: toNum(data?.total_other_paid_rounded_rupees),
    finePaid: toNum(data?.total_fine_paid_rounded_rupees),
  };
}

function toBreakupDetailsRow({
  summary = {},
  id = "",
  name = "",
  idKey = "id",
  nameKey = "name",
}) {
  const totals = toBreakupResponse(summary);
  return {
    [idKey]: String(id || "").trim(),
    [nameKey]: String(name || "").trim(),
    ...totals,
    total_late_fee_arrear_and_fine: toNum(
      summary?.data?.total_late_fee_arrear_rounded_rupees
    ),
  };
}

function rowIdentity(row = {}, type = "") {
  if (type === "division") {
    return {
      id: String(row?.division_id || "").trim(),
      name: String(row?.division_name || "").trim(),
      idKey: "division_id",
      nameKey: "division_name",
      idField: "division_id",
      nameField: "division",
      camelIdField: "divisionId",
    };
  }
  if (type === "collection_center") {
    return {
      id: String(row?.collection_center_id || "").trim(),
      name: String(row?.collection_center_name || "").trim(),
      idKey: "collection_center_id",
      nameKey: "collection_center_name",
      idField: "collection_center_id",
      nameField: "collection_center",
      camelIdField: "collectionCenterId",
      camelNameField: "collectionCenter",
    };
  }
  return {
    id: String(row?.scheme_id || "").trim(),
    name: String(row?.scheme_name || "").trim(),
    idKey: "scheme_id",
    nameKey: "scheme_name",
    idField: "scheme_id",
    nameField: "scheme",
    camelIdField: "schemeId",
  };
}

function groupKeys(type = "") {
  if (type === "division") {
    return {
      idKey: "division_id",
      nameKey: "division_name",
    };
  }
  if (type === "collection_center") {
    return {
      idKey: "collection_center_id",
      nameKey: "collection_center_name",
    };
  }
  return {
    idKey: "scheme_id",
    nameKey: "scheme_name",
  };
}

function sortRows(rows = [], { sortBy = "total_amount", sortOrder = "desc", type = "" } = {}) {
  const numericSortKeys = new Set([
    "total_bill_generated_count",
    "total_bill_paid_count",
    "total_bill_cancelled_count",
    "total_bill_cancelled_amount",
    "total_bill_waived_off_count",
    "total_bill_waived_off_amount",
    "total_bill_wavied_off_count",
    "total_bill_wavied_off_amount",
    "total_amount",
    "total_collected_amount",
    "total_water_charges",
    "total_sewer_charges",
    "total_other_charges",
    "total_meter_rent",
    "total_water_arrear",
    "total_sewer_arrear",
    "total_other_arrear",
    "total_meter_rent_arrear",
    "total_late_fine_arrear",
    "total_late_fine",
    "total_arrear",
    "total_advance",
    "total_discount",
    "total_late_fee_arrear_and_fine",
    "waterPaid",
    "meterPaid",
    "sewerPaid",
    "otherPaid",
    "finePaid",
  ]);
  const allowedKeys = new Set([
    ...numericSortKeys,
    "division_id",
    "division_name",
    "collection_center_id",
    "collection_center_name",
    "scheme_id",
    "scheme_name",
  ]);
  const normalizedSortBy = allowedKeys.has(String(sortBy || "").trim())
    ? String(sortBy || "").trim()
    : "total_amount";
  const normalizedSortOrder = normalizeSortOrder(sortOrder, "desc");
  const factor = normalizedSortOrder === "asc" ? 1 : -1;

  const typeNameKey =
    type === "division"
      ? "division_name"
      : type === "collection_center"
      ? "collection_center_name"
      : "scheme_name";

  return [...rows].sort((a, b) => {
    if (numericSortKeys.has(normalizedSortBy)) {
      const aNum = toNum(a?.[normalizedSortBy]);
      const bNum = toNum(b?.[normalizedSortBy]);
      if (aNum !== bNum) return (aNum - bNum) * factor;
      const aName = String(a?.[typeNameKey] || "").toLowerCase();
      const bName = String(b?.[typeNameKey] || "").toLowerCase();
      return aName.localeCompare(bName);
    }
    const aVal = String(a?.[normalizedSortBy] || "").toLowerCase();
    const bVal = String(b?.[normalizedSortBy] || "").toLowerCase();
    return aVal.localeCompare(bVal) * factor;
  });
}

function paginateRows(rows = [], page = 1, pageSize = 50) {
  const total_count = rows.length;
  const normalizedPageSize = toPositiveInt(pageSize, 50);
  const total_pages = Math.max(Math.ceil(total_count / normalizedPageSize), 1);
  const normalizedPage = Math.min(toPositiveInt(page, 1), total_pages);
  const start = (normalizedPage - 1) * normalizedPageSize;
  const end = start + normalizedPageSize;

  return {
    rows: rows.slice(start, end),
    pagination: {
      page: normalizedPage,
      page_size: normalizedPageSize,
      total_count,
      total_pages,
    },
  };
}

function applySortAndPagination(rows = [], options = {}) {
  const sorted = sortRows(rows, {
    sortBy: options.sortBy,
    sortOrder: options.sortOrder,
    type: options.type,
  });
  const paginated = paginateRows(sorted, options.page, options.pageSize);
  return {
    rows: paginated.rows,
    pagination: {
      ...paginated.pagination,
      sort_by: options.sortBy,
      sort_order: options.sortOrder,
    },
  };
}

async function fetchDepartmentDivisions(departmentId = "") {
  const dep = cleanString(departmentId);
  if (!dep) return [];
  try {
    const response = await getDivisionsByDepartment({
      department_id: dep,
      departmentId: dep,
    });
    const divisions = Array.isArray(response?.divisions) ? response.divisions : [];
    return divisions.map((d) => ({
      division_id: firstNonEmpty(d?.id, d?._id, d?.division_id),
      division_name: firstNonEmpty(d?.name, d?.title, d?.division_name),
    }));
  } catch {
    return [];
  }
}

async function fetchCollectionCentersByScope({ department_id = "", division_id = "" }) {
  const dep = cleanString(department_id);
  const div = cleanString(division_id);
  if (!dep && !div) return [];
  try {
    const out = await getCollectionCenters({
      department_id: dep,
      departmentId: dep,
      division_id: div,
      divisionId: div,
    });
    const rows = Array.isArray(out?.collectionCenters) ? out.collectionCenters : [];
    return rows.map((c) => ({
      collection_center_id: firstNonEmpty(
        c?.id,
        c?._id,
        c?.collection_center_id
      ),
      collection_center_name: firstNonEmpty(
        c?.title,
        c?.name,
        c?.collection_center_name
      ),
    }));
  } catch {
    return [];
  }
}

async function fetchSchemesByScope({ department_id = "", division_id = "" }) {
  const dep = cleanString(department_id);
  const div = cleanString(division_id);
  if (!dep && !div) return [];
  try {
    const out = await getSchemes({
      department_id: dep,
      departmentId: dep,
      division_id: div,
      divisionId: div,
    });
    const rows = Array.isArray(out?.schemes) ? out.schemes : [];
    return rows.map((s) => ({
      scheme_id: firstNonEmpty(s?.id, s?._id, s?.scheme_id),
      scheme_name: firstNonEmpty(s?.title, s?.name, s?.scheme_name),
    }));
  } catch {
    return [];
  }
}

async function fetchSchemesByIds(schemeIds = []) {
  const uniqueIds = [...new Set((schemeIds || []).map(cleanString).filter(Boolean))];
  const responses = await Promise.all(
    uniqueIds.map(async (schemeId) => {
      try {
        const out = await getSchemeById(schemeId);
        const scheme = out?.scheme || {};
        return {
          scheme_id: firstNonEmpty(scheme?.id, scheme?._id, schemeId),
          scheme_name: firstNonEmpty(
            scheme?.title,
            scheme?.name,
            scheme?.scheme_name
          ),
        };
      } catch {
        return null;
      }
    })
  );
  return responses.filter((row) => row?.scheme_id && row?.scheme_name);
}

async function resolveSchemeMasterRows({
  summaryRows = [],
  department_id = "",
  division_id = "",
}) {
  const scopedRows = await fetchSchemesByScope({ department_id, division_id });
  const scopedIds = new Set(
    scopedRows
      .filter((row) => cleanString(row?.scheme_name))
      .map((row) => cleanString(row?.scheme_id))
  );
  const missingIds = (summaryRows || [])
    .map((row) => cleanString(row?.scheme_id))
    .filter((id) => id && !scopedIds.has(id));
  if (!missingIds.length) return scopedRows;
  return [...scopedRows, ...(await fetchSchemesByIds(missingIds))];
}

async function fetchMasterRows({ type = "", department_id = "", division_id = "" }) {
  const dep = cleanString(department_id);
  const div = cleanString(division_id);
  if (type === "division") return fetchDepartmentDivisions(dep);
  if (type === "collection_center") {
    return fetchCollectionCentersByScope({ department_id: dep, division_id: div });
  }
  return fetchSchemesByScope({ department_id: dep, division_id: div });
}

function findNameById(rows = [], { idKey = "", nameKey = "", id = "" } = {}) {
  const targetId = cleanString(id);
  if (!targetId) return "";
  const match = (rows || []).find(
    (row) => cleanString(row?.[idKey]) === targetId
  );
  return cleanString(match?.[nameKey]);
}

async function resolveBillAmountBreakupPdfContext(body = {}) {
  const departmentId = cleanString(
    body.department_id || body.departmentId || body.department
  );
  const divisionId = cleanString(body.division_id || body.divisionId || body.division);
  const collectionCenterId = cleanString(
    body.collection_center_id ||
      body.collectionCenterId ||
      body.collection_center ||
      body.collectionCenter
  );

  const divisionNameFromBody = cleanString(body.division);
  const collectionCenterNameFromBody = cleanString(
    body.collection_center || body.collectionCenter
  );

  const [divisionRows, collectionCenterRows] = await Promise.all([
    !divisionNameFromBody && departmentId && divisionId
      ? fetchMasterRows({
          type: "division",
          department_id: departmentId,
          division_id: divisionId,
        })
      : Promise.resolve([]),
    !collectionCenterNameFromBody && collectionCenterId && (departmentId || divisionId)
      ? fetchMasterRows({
          type: "collection_center",
          department_id: departmentId,
          division_id: divisionId,
        })
      : Promise.resolve([]),
  ]);

  return {
    division_name:
      divisionNameFromBody ||
      findNameById(divisionRows, {
        idKey: "division_id",
        nameKey: "division_name",
        id: divisionId,
      }),
    collection_center_name:
      collectionCenterNameFromBody ||
      findNameById(collectionCenterRows, {
        idKey: "collection_center_id",
        nameKey: "collection_center_name",
        id: collectionCenterId,
      }),
  };
}

export function normalizeScopedGroupRows({
  type = "",
  summaryRows = [],
  masterRows = [],
  requestedId = "",
  requestedName = "",
}) {
  const { idKey, nameKey } = groupKeys(type);
  const normalizedRequestedId = cleanString(requestedId);
  const normalizedRequestedName = cleanString(requestedName);

  const masterNameById = new Map(
    (masterRows || [])
      .map((row) => [cleanString(row?.[idKey]), cleanString(row?.[nameKey])])
      .filter(([id]) => Boolean(id))
  );

  const summaryMap = new Map();
  for (const row of summaryRows || []) {
    const id = cleanString(row?.[idKey]);
    if (!id) continue;
    const existing = summaryMap.get(id) || {};
    summaryMap.set(id, {
      [idKey]: id,
      [nameKey]: cleanString(
        masterNameById.get(id) || existing?.[nameKey] || row?.[nameKey]
      ),
    });
  }

  const targetIds = normalizedRequestedId
    ? [normalizedRequestedId]
    : [...summaryMap.keys()];

  return targetIds
    .filter(Boolean)
    .map((id) => {
      const row = summaryMap.get(id) || {};
      return {
        [idKey]: id,
        [nameKey]: cleanString(
          row?.[nameKey] ||
            masterNameById.get(id) ||
            (id === normalizedRequestedId ? normalizedRequestedName : "")
        ),
      };
    });
}

async function buildGroupWiseDetails({
  rows = [],
  type = "",
  basePayload = {},
}) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const details = await Promise.all(
    rows.map(async (row) => {
      const identity = rowIdentity(row, type);
      if (!identity.id) return null;

      const payload = {
        ...basePayload,
        [identity.idField]: identity.id,
        [identity.nameField]: identity.name,
      };
      if (identity.camelIdField) {
        payload[identity.camelIdField] = identity.id;
      }
      if (identity.camelNameField) {
        payload[identity.camelNameField] = identity.name;
      }

      const summary = await fetchBillCollectionSummary(payload);

      return toBreakupDetailsRow({
        summary,
        id: identity.id,
        name: identity.name,
        idKey: identity.idKey,
        nameKey: identity.nameKey,
      });
    })
  );

  return details.filter(Boolean);
}

async function buildBillAmountBreakupSummaryResponse(
  body = {},
  options = {}
) {
  const normalizedBody = normalizeMonthRangePayload(body);
  const includePagination = options?.paginate !== false;
  const groupByDivision =
    normalizedBody.group_by_division ?? normalizedBody.groupByDivision ?? true;
  const groupByCollectionCenter =
    normalizedBody.group_by_collection_center ??
    normalizedBody.groupByCollectionCenter ??
    true;
  const groupByScheme =
    normalizedBody.group_by_scheme ?? normalizedBody.groupByScheme ?? true;
  const globalSortBy = String(
    normalizedBody.sort_by || normalizedBody.sortBy || "total_amount"
  ).trim();
  const globalSortOrder = normalizeSortOrder(
    normalizedBody.sort_order || normalizedBody.sortOrder || "desc",
    "desc"
  );
  const globalPage = toPositiveInt(normalizedBody.page, 1);
  const globalPageSize = toPositiveInt(
    normalizedBody.page_size ?? normalizedBody.pageSize,
    50
  );

  const payload = {
    ...normalizedBody,
    group_by_division: groupByDivision,
    groupByDivision: groupByDivision,
    group_by_collection_center: groupByCollectionCenter,
    groupByCollectionCenter: groupByCollectionCenter,
    group_by_scheme: groupByScheme,
    groupByScheme: groupByScheme,
  };
  const totalsOnlyPayload = {
    ...normalizedBody,
    group_by_division: false,
    groupByDivision: false,
    group_by_collection_center: false,
    groupByCollectionCenter: false,
    group_by_scheme: false,
    groupByScheme: false,
  };

  const departmentId = cleanString(
    normalizedBody.department_id ||
      normalizedBody.departmentId ||
      normalizedBody.department
  );
  const divisionId = cleanString(
    normalizedBody.division_id || normalizedBody.divisionId || normalizedBody.division
  );
  const collectionCenterId = cleanString(
    normalizedBody.collection_center_id ||
      normalizedBody.collectionCenterId ||
      normalizedBody.collection_center ||
      normalizedBody.collectionCenter
  );
  const schemeId = cleanString(
    normalizedBody.scheme_id || normalizedBody.schemeId || normalizedBody.scheme
  );

  const summary = await fetchBillCollectionSummary(payload);
  const summarySchemeRows = Array.isArray(summary?.data?.scheme_wise)
    ? summary.data.scheme_wise
    : [];

  const divisionRows = groupByDivision
    ? normalizeScopedGroupRows({
        type: "division",
        summaryRows: Array.isArray(summary?.data?.division_wise)
          ? summary.data.division_wise
          : [],
        masterRows: await fetchMasterRows({
          type: "division",
          department_id: departmentId,
          division_id: divisionId,
        }),
        requestedId: divisionId,
        requestedName: cleanString(normalizedBody.division),
      })
    : [];
  const collectionCenterRows = groupByCollectionCenter
    ? normalizeScopedGroupRows({
        type: "collection_center",
        summaryRows: Array.isArray(summary?.data?.collection_center_wise)
          ? summary.data.collection_center_wise
          : [],
        masterRows: await fetchMasterRows({
          type: "collection_center",
          department_id: departmentId,
          division_id: divisionId,
        }),
        requestedId: collectionCenterId,
        requestedName: cleanString(
          normalizedBody.collection_center || normalizedBody.collectionCenter
        ),
      })
    : [];
  const schemeRows = groupByScheme
    ? normalizeScopedGroupRows({
        type: "scheme",
        summaryRows: summarySchemeRows,
        masterRows: await resolveSchemeMasterRows({
          summaryRows: summarySchemeRows,
          department_id: departmentId,
          division_id: divisionId,
        }),
        requestedId: schemeId,
        requestedName: cleanString(normalizedBody.scheme),
      })
    : [];

  const divisionWiseDetails = groupByDivision
    ? await buildGroupWiseDetails({
        rows: divisionRows,
        type: "division",
        basePayload: totalsOnlyPayload,
      })
    : [];
  const collectionCenterWiseDetails = groupByCollectionCenter
    ? await buildGroupWiseDetails({
        rows: collectionCenterRows,
        type: "collection_center",
        basePayload: totalsOnlyPayload,
      })
    : [];
  const schemeWiseDetails = groupByScheme
    ? await buildGroupWiseDetails({
        rows: schemeRows,
        type: "scheme",
        basePayload: totalsOnlyPayload,
      })
    : [];

  const totals = toBreakupResponse(summary);
  const data = {
    filters: summary?.filters || {},
    totals,
  };

  if (groupByDivision) {
    if (includePagination) {
      const divisionSortBy = String(
        normalizedBody.division_sort_by || normalizedBody.divisionSortBy || globalSortBy
      ).trim();
      const divisionSortOrder = normalizeSortOrder(
        normalizedBody.division_sort_order ||
          normalizedBody.divisionSortOrder ||
          globalSortOrder,
        globalSortOrder
      );
      const divisionPage = toPositiveInt(
        normalizedBody.division_page ?? normalizedBody.divisionPage,
        globalPage
      );
      const divisionPageSize = toPositiveInt(
        normalizedBody.division_page_size ?? normalizedBody.divisionPageSize,
        globalPageSize
      );
      const pagedDivision = applySortAndPagination(divisionWiseDetails, {
        type: "division",
        sortBy: divisionSortBy,
        sortOrder: divisionSortOrder,
        page: divisionPage,
        pageSize: divisionPageSize,
      });
      data.division_wise_details = pagedDivision.rows;
      data.division_wise_pagination = pagedDivision.pagination;
    } else {
      data.division_wise_details = sortRows(divisionWiseDetails, {
        type: "division",
        sortBy:
          normalizedBody.division_sort_by ||
          normalizedBody.divisionSortBy ||
          globalSortBy,
        sortOrder:
          normalizedBody.division_sort_order ||
          normalizedBody.divisionSortOrder ||
          globalSortOrder,
      });
    }
  }

  if (groupByCollectionCenter) {
    if (includePagination) {
      const collectionCenterSortBy = String(
        normalizedBody.collection_center_sort_by ||
          normalizedBody.collectionCenterSortBy ||
          globalSortBy
      ).trim();
      const collectionCenterSortOrder = normalizeSortOrder(
        normalizedBody.collection_center_sort_order ||
          normalizedBody.collectionCenterSortOrder ||
          globalSortOrder,
        globalSortOrder
      );
      const collectionCenterPage = toPositiveInt(
        normalizedBody.collection_center_page ?? normalizedBody.collectionCenterPage,
        globalPage
      );
      const collectionCenterPageSize = toPositiveInt(
        normalizedBody.collection_center_page_size ??
          normalizedBody.collectionCenterPageSize,
        globalPageSize
      );
      const pagedCollectionCenter = applySortAndPagination(
        collectionCenterWiseDetails,
        {
          type: "collection_center",
          sortBy: collectionCenterSortBy,
          sortOrder: collectionCenterSortOrder,
          page: collectionCenterPage,
          pageSize: collectionCenterPageSize,
        }
      );
      data.collection_center_wise_details = pagedCollectionCenter.rows;
      data.collection_center_wise_pagination = pagedCollectionCenter.pagination;
    } else {
      data.collection_center_wise_details = sortRows(collectionCenterWiseDetails, {
        type: "collection_center",
        sortBy:
          normalizedBody.collection_center_sort_by ||
          normalizedBody.collectionCenterSortBy ||
          globalSortBy,
        sortOrder:
          normalizedBody.collection_center_sort_order ||
          normalizedBody.collectionCenterSortOrder ||
          globalSortOrder,
      });
    }
  }

  if (groupByScheme) {
    if (includePagination) {
      const schemeSortBy = String(
        normalizedBody.scheme_sort_by || normalizedBody.schemeSortBy || globalSortBy
      ).trim();
      const schemeSortOrder = normalizeSortOrder(
        normalizedBody.scheme_sort_order ||
          normalizedBody.schemeSortOrder ||
          globalSortOrder,
        globalSortOrder
      );
      const schemePage = toPositiveInt(
        normalizedBody.scheme_page ?? normalizedBody.schemePage,
        globalPage
      );
      const schemePageSize = toPositiveInt(
        normalizedBody.scheme_page_size ?? normalizedBody.schemePageSize,
        globalPageSize
      );
      const pagedScheme = applySortAndPagination(schemeWiseDetails, {
        type: "scheme",
        sortBy: schemeSortBy,
        sortOrder: schemeSortOrder,
        page: schemePage,
        pageSize: schemePageSize,
      });
      data.scheme_wise_details = pagedScheme.rows;
      data.scheme_wise_pagination = pagedScheme.pagination;
    } else {
      data.scheme_wise_details = sortRows(schemeWiseDetails, {
        type: "scheme",
        sortBy:
          normalizedBody.scheme_sort_by ||
          normalizedBody.schemeSortBy ||
          globalSortBy,
        sortOrder:
          normalizedBody.scheme_sort_order ||
          normalizedBody.schemeSortOrder ||
          globalSortOrder,
      });
    }
  }

  console.log("[bill-amount-breakup-summary-report] patched-response", {
    department_id: departmentId || null,
    division_id: divisionId || null,
    start_date:
      summary?.filters?.start_date ||
      normalizedBody.start_date ||
      normalizedBody.startDate ||
      null,
    end_date:
      summary?.filters?.end_date ||
      normalizedBody.end_date ||
      normalizedBody.endDate ||
      null,
    total_bill_generated_count: totals.total_bill_generated_count,
    total_bill_paid_count: totals.total_bill_paid_count,
    total_collected_amount_paid_and_partial: totals.total_collected_amount,
  });

  return data;
}

async function createBillAmountBreakupSummaryHandler(req, reply) {
  try {
    const data = await buildBillAmountBreakupSummaryResponse(req.body || {});
    return reply.send({ ok: true, data });
  } catch (err) {
    req.log.error({ err }, "bill-amount-breakup-summary-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch bill amount breakup summary report",
      error: err?.message || String(err),
    });
  }
}

async function createBillAmountBreakupSummaryPdfHandler(req, reply) {
  try {
    const body = req.body || {};
    const normalizedBody = normalizeMonthRangePayload(body);
    const data = await buildBillAmountBreakupSummaryResponse(normalizedBody, {
      paginate: false,
    });
    const pdfContext = await resolveBillAmountBreakupPdfContext(normalizedBody);
    const pdf = await createBillAmountBreakupSummaryPdf({
      body: normalizedBody,
      data,
      pdfContext,
      department:
        normalizedBody?.departmentId ||
        normalizedBody?.department_id ||
        normalizedBody?.department ||
        data?.filters?.departmentId ||
        data?.filters?.department_id ||
        data?.filters?.department,
    });
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename=\"bill-amount-breakup-summary-report-${ts}.pdf\"`
    );
    return reply.send(pdf);
  } catch (err) {
    req.log.error({ err }, "bill-amount-breakup-summary-report-pdf failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch bill amount breakup summary report pdf",
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

  fastify.post(
    "/bill-amount-breakup-summary-report-pdf",
    {
      ...authRoute(
        {
          tags: ["Billing Report"],
          body: reportBody,
        },
        "Billing Report"
      ),
    },
    createBillAmountBreakupSummaryPdfHandler
  );
}

export default fp(routes);
