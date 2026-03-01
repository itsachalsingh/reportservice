import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { getDivisionsByDepartment } from "../utils/grpc/divisionClient.js";
import { getCollectionCenters } from "../utils/grpc/collectionCenterClient.js";
import { getSchemes } from "../utils/grpc/schemeClient.js";
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

const DAY_TTL_SECONDS = 24 * 60 * 60;
const REPORT_CACHE_TTL_SECONDS = Number(
  process.env.BILL_AMOUNT_BREAKUP_CACHE_TTL_SECONDS || DAY_TTL_SECONDS
);
const MASTER_CACHE_TTL_SECONDS = Number(
  process.env.BILL_AMOUNT_BREAKUP_MASTER_CACHE_TTL_SECONDS || DAY_TTL_SECONDS
);

function toNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTtl(ttl) {
  const parsed = Number(ttl);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
    total_discount: 0,
    total_late_fee_arrear_and_fine: totals.total_late_fine,
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

function sortRows(rows = [], { sortBy = "total_amount", sortOrder = "desc", type = "" } = {}) {
  const numericSortKeys = new Set([
    "total_bill_generated_count",
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
      division_id: cleanString(d?.id),
      division_name: cleanString(d?.title),
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
      collection_center_id: cleanString(c?.id),
      collection_center_name: cleanString(c?.title),
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
      scheme_id: cleanString(s?.id),
      scheme_name: cleanString(s?.title),
    }));
  } catch {
    return [];
  }
}

async function fetchMasterRowsCached({ type = "", department_id = "", division_id = "", ttl = 0, log = null }) {
  const dep = cleanString(department_id);
  const div = cleanString(division_id);
  const keyPayload = { type, department_id: dep, division_id: div };
  const loader = () => {
    if (type === "division") return fetchDepartmentDivisions(dep);
    if (type === "collection_center") {
      return fetchCollectionCentersByScope({ department_id: dep, division_id: div });
    }
    return fetchSchemesByScope({ department_id: dep, division_id: div });
  };

  if (!ttl) return loader();

  const { value } = await cachedJson({
    prefix: "report:bill-amount-breakup:master:v1",
    keyPayload,
    ttlSeconds: ttl,
    loader,
    log,
  });
  return Array.isArray(value) ? value : [];
}

function mergeWithMasterRows({ type = "", summaryRows = [], masterRows = [] }) {
  const idKey =
    type === "division"
      ? "division_id"
      : type === "collection_center"
      ? "collection_center_id"
      : "scheme_id";
  const nameKey =
    type === "division"
      ? "division_name"
      : type === "collection_center"
      ? "collection_center_name"
      : "scheme_name";

  const map = new Map();
  for (const row of summaryRows || []) {
    const id = cleanString(row?.[idKey]);
    if (!id) continue;
    map.set(id, {
      [idKey]: id,
      [nameKey]: cleanString(row?.[nameKey]),
    });
  }
  for (const row of masterRows || []) {
    const id = cleanString(row?.[idKey]);
    if (!id) continue;
    const existing = map.get(id) || {};
    map.set(id, {
      [idKey]: id,
      [nameKey]: cleanString(existing?.[nameKey] || row?.[nameKey]),
    });
  }
  return [...map.values()];
}

async function buildGroupWiseDetails({
  rows = [],
  type = "",
  basePayload = {},
  scope = "",
  ttl = 0,
  log = null,
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

      const summary = ttl
        ? (
            await cachedJson({
              prefix: "report:bill-amount-breakup:group:v1",
              keyPayload: { payload, scope },
              ttlSeconds: ttl,
              loader: () => fetchBillCollectionSummary(payload),
              log,
            })
          ).value
        : await fetchBillCollectionSummary(payload);

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

async function createBillAmountBreakupSummaryHandler(req, reply) {
  try {
    const body = req.body || {};
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

    const ttl = normalizeTtl(REPORT_CACHE_TTL_SECONDS);
    const masterTtl = normalizeTtl(MASTER_CACHE_TTL_SECONDS);
    const scope = `${req.user?.id || req.user?._id || ""}:${req.user?.role_id || ""}`;
    const departmentId = cleanString(
      body.department_id || body.departmentId || body.department
    );
    const divisionId = cleanString(body.division_id || body.divisionId || body.division);

    const summary = ttl
      ? (
          await cachedJson({
            prefix: "report:bill-amount-breakup:v3",
            keyPayload: { payload, scope },
            ttlSeconds: ttl,
            loader: () => fetchBillCollectionSummary(payload),
            log: req.log,
          })
        ).value
      : await fetchBillCollectionSummary(payload);

    const divisionRows = groupByDivision
      ? mergeWithMasterRows({
          type: "division",
          summaryRows: Array.isArray(summary?.data?.division_wise)
            ? summary.data.division_wise
            : [],
          masterRows: await fetchMasterRowsCached({
            type: "division",
            department_id: departmentId,
            division_id: divisionId,
            ttl: masterTtl,
            log: req.log,
          }),
        })
      : [];
    const collectionCenterRows = groupByCollectionCenter
      ? mergeWithMasterRows({
          type: "collection_center",
          summaryRows: Array.isArray(summary?.data?.collection_center_wise)
            ? summary.data.collection_center_wise
            : [],
          masterRows: await fetchMasterRowsCached({
            type: "collection_center",
            department_id: departmentId,
            division_id: divisionId,
            ttl: masterTtl,
            log: req.log,
          }),
        })
      : [];
    const schemeRows = groupByScheme
      ? mergeWithMasterRows({
          type: "scheme",
          summaryRows: Array.isArray(summary?.data?.scheme_wise) ? summary.data.scheme_wise : [],
          masterRows: await fetchMasterRowsCached({
            type: "scheme",
            department_id: departmentId,
            division_id: divisionId,
            ttl: masterTtl,
            log: req.log,
          }),
        })
      : [];

    const divisionWiseDetails = groupByDivision
      ? await buildGroupWiseDetails({
          rows: divisionRows,
          type: "division",
          basePayload: totalsOnlyPayload,
          scope,
          ttl,
          log: req.log,
        })
      : [];
    const collectionCenterWiseDetails = groupByCollectionCenter
      ? await buildGroupWiseDetails({
          rows: collectionCenterRows,
          type: "collection_center",
          basePayload: totalsOnlyPayload,
          scope,
          ttl,
          log: req.log,
        })
      : [];
    const schemeWiseDetails = groupByScheme
      ? await buildGroupWiseDetails({
          rows: schemeRows,
          type: "scheme",
          basePayload: totalsOnlyPayload,
          scope,
          ttl,
          log: req.log,
        })
      : [];

    const divisionSortBy = String(
      body.division_sort_by || body.divisionSortBy || globalSortBy
    ).trim();
    const divisionSortOrder = normalizeSortOrder(
      body.division_sort_order || body.divisionSortOrder || globalSortOrder,
      globalSortOrder
    );
    const divisionPage = toPositiveInt(body.division_page ?? body.divisionPage, globalPage);
    const divisionPageSize = toPositiveInt(
      body.division_page_size ?? body.divisionPageSize,
      globalPageSize
    );

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

    const pagedDivision = groupByDivision
      ? applySortAndPagination(divisionWiseDetails, {
          type: "division",
          sortBy: divisionSortBy,
          sortOrder: divisionSortOrder,
          page: divisionPage,
          pageSize: divisionPageSize,
        })
      : { rows: [], pagination: null };
    const pagedCollectionCenter = groupByCollectionCenter
      ? applySortAndPagination(collectionCenterWiseDetails, {
          type: "collection_center",
          sortBy: collectionCenterSortBy,
          sortOrder: collectionCenterSortOrder,
          page: collectionCenterPage,
          pageSize: collectionCenterPageSize,
        })
      : { rows: [], pagination: null };
    const pagedScheme = groupByScheme
      ? applySortAndPagination(schemeWiseDetails, {
          type: "scheme",
          sortBy: schemeSortBy,
          sortOrder: schemeSortOrder,
          page: schemePage,
          pageSize: schemePageSize,
        })
      : { rows: [], pagination: null };

    return reply.send({
      ok: true,
      data: {
        filters: summary?.filters || {},
        totals: toBreakupResponse(summary),
        ...(groupByDivision
          ? {
              division_wise_details: pagedDivision.rows,
              division_wise_pagination: pagedDivision.pagination,
            }
          : {}),
        ...(groupByCollectionCenter
          ? {
              collection_center_wise_details: pagedCollectionCenter.rows,
              collection_center_wise_pagination: pagedCollectionCenter.pagination,
            }
          : {}),
        ...(groupByScheme
          ? {
              scheme_wise_details: pagedScheme.rows,
              scheme_wise_pagination: pagedScheme.pagination,
            }
          : {}),
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
