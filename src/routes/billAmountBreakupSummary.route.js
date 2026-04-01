import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { getDivisionsByDepartment } from "../utils/grpc/divisionClient.js";
import { getCollectionCenters } from "../utils/grpc/collectionCenterClient.js";
import { getSchemes } from "../utils/grpc/schemeClient.js";
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

  return {
    total_bill_generated_count: totalBillGeneratedCount,
    total_bill_paid_count: totalBillPaidCount,
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
    total_discount: toNum(data?.total_discount_rounded_rupees),
    total_arrear: toNum(data?.total_arrear_rounded_rupees) || totalArrearFallback,
    total_advance: toNum(data?.total_advance_rounded_rupees),
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

async function fetchMasterRows({ type = "", department_id = "", division_id = "" }) {
  const dep = cleanString(department_id);
  const div = cleanString(division_id);
  if (type === "division") return fetchDepartmentDivisions(dep);
  if (type === "collection_center") {
    return fetchCollectionCentersByScope({ department_id: dep, division_id: div });
  }
  return fetchSchemesByScope({ department_id: dep, division_id: div });
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
        existing?.[nameKey] || row?.[nameKey] || masterNameById.get(id)
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
  const includePagination = options?.paginate !== false;
  const groupByDivision = body.group_by_division ?? body.groupByDivision ?? true;
  const groupByCollectionCenter =
    body.group_by_collection_center ?? body.groupByCollectionCenter ?? true;
  const groupByScheme = body.group_by_scheme ?? body.groupByScheme ?? true;
  const globalSortBy = String(body.sort_by || body.sortBy || "total_amount").trim();
  const globalSortOrder = normalizeSortOrder(
    body.sort_order || body.sortOrder || "desc",
    "desc"
  );
  const globalPage = toPositiveInt(body.page, 1);
  const globalPageSize = toPositiveInt(body.page_size ?? body.pageSize, 50);

  const payload = {
    ...body,
    group_by_division: groupByDivision,
    groupByDivision: groupByDivision,
    group_by_collection_center: groupByCollectionCenter,
    groupByCollectionCenter: groupByCollectionCenter,
    group_by_scheme: groupByScheme,
    groupByScheme: groupByScheme,
  };
  const totalsOnlyPayload = {
    ...body,
    group_by_division: false,
    groupByDivision: false,
    group_by_collection_center: false,
    groupByCollectionCenter: false,
    group_by_scheme: false,
    groupByScheme: false,
  };

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
  const schemeId = cleanString(body.scheme_id || body.schemeId || body.scheme);

  const summary = await fetchBillCollectionSummary(payload);

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
        requestedName: cleanString(body.division),
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
        requestedName: cleanString(body.collection_center || body.collectionCenter),
      })
    : [];
  const schemeRows = groupByScheme
    ? normalizeScopedGroupRows({
        type: "scheme",
        summaryRows: Array.isArray(summary?.data?.scheme_wise)
          ? summary.data.scheme_wise
          : [],
        masterRows: await fetchMasterRows({
          type: "scheme",
          department_id: departmentId,
          division_id: divisionId,
        }),
        requestedId: schemeId,
        requestedName: cleanString(body.scheme),
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
        body.division_sort_by || body.divisionSortBy || globalSortBy
      ).trim();
      const divisionSortOrder = normalizeSortOrder(
        body.division_sort_order || body.divisionSortOrder || globalSortOrder,
        globalSortOrder
      );
      const divisionPage = toPositiveInt(
        body.division_page ?? body.divisionPage,
        globalPage
      );
      const divisionPageSize = toPositiveInt(
        body.division_page_size ?? body.divisionPageSize,
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
        sortBy: body.division_sort_by || body.divisionSortBy || globalSortBy,
        sortOrder:
          body.division_sort_order || body.divisionSortOrder || globalSortOrder,
      });
    }
  }

  if (groupByCollectionCenter) {
    if (includePagination) {
      const collectionCenterSortBy = String(
        body.collection_center_sort_by ||
          body.collectionCenterSortBy ||
          globalSortBy
      ).trim();
      const collectionCenterSortOrder = normalizeSortOrder(
        body.collection_center_sort_order ||
          body.collectionCenterSortOrder ||
          globalSortOrder,
        globalSortOrder
      );
      const collectionCenterPage = toPositiveInt(
        body.collection_center_page ?? body.collectionCenterPage,
        globalPage
      );
      const collectionCenterPageSize = toPositiveInt(
        body.collection_center_page_size ?? body.collectionCenterPageSize,
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
          body.collection_center_sort_by ||
          body.collectionCenterSortBy ||
          globalSortBy,
        sortOrder:
          body.collection_center_sort_order ||
          body.collectionCenterSortOrder ||
          globalSortOrder,
      });
    }
  }

  if (groupByScheme) {
    if (includePagination) {
      const schemeSortBy = String(
        body.scheme_sort_by || body.schemeSortBy || globalSortBy
      ).trim();
      const schemeSortOrder = normalizeSortOrder(
        body.scheme_sort_order || body.schemeSortOrder || globalSortOrder,
        globalSortOrder
      );
      const schemePage = toPositiveInt(body.scheme_page ?? body.schemePage, globalPage);
      const schemePageSize = toPositiveInt(
        body.scheme_page_size ?? body.schemePageSize,
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
        sortBy: body.scheme_sort_by || body.schemeSortBy || globalSortBy,
        sortOrder: body.scheme_sort_order || body.schemeSortOrder || globalSortOrder,
      });
    }
  }

  console.log("[bill-amount-breakup-summary-report] patched-response", {
    department_id: departmentId || null,
    division_id: divisionId || null,
    start_date:
      summary?.filters?.start_date || body.start_date || body.startDate || null,
    end_date:
      summary?.filters?.end_date || body.end_date || body.endDate || null,
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
    const data = await buildBillAmountBreakupSummaryResponse(body, {
      paginate: false,
    });
    const pdf = await createBillAmountBreakupSummaryPdf({
      body,
      data,
      department:
        body?.departmentId ||
        body?.department_id ||
        body?.department ||
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
