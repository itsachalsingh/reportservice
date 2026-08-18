import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { getConnectionCountSummary } from "../utils/grpc/connectionClient.js";
import { getDivisionsByDepartment } from "../utils/grpc/divisionClient.js";
import { getSchemes } from "../utils/grpc/schemeClient.js";
import { getCollectionCenters } from "../utils/grpc/collectionCenterClient.js";
import { createBillCollectionSummaryPdf } from "../utils/billCollectionSummaryPdf.js";
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
  },
};

const DAY_TTL_SECONDS = 24 * 60 * 60;
const RESPONSE_CACHE_TTL_SECONDS = Number(
  process.env.BILL_COLLECTION_RESPONSE_CACHE_TTL_SECONDS ||
    process.env.BILL_COLLECTION_REPORT_CACHE_TTL_SECONDS ||
    DAY_TTL_SECONDS
);
const MASTER_CACHE_TTL_SECONDS = Number(
  process.env.BILL_COLLECTION_MASTER_CACHE_TTL_SECONDS || DAY_TTL_SECONDS
);
const COUNT_CACHE_TTL_SECONDS = Number(
  process.env.BILL_COLLECTION_COUNT_CACHE_TTL_SECONDS || DAY_TTL_SECONDS
);

function normalizeTtl(ttl) {
  const parsed = Number(ttl);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sumConnectionRows(rows = []) {
  return rows.reduce((acc, item) => {
    const active = Number(item?.active || 0);
    const inactive = Number(item?.inactive || 0);
    const rowTotal = active + inactive;
    return acc + (Number.isFinite(rowTotal) ? rowTotal : 0);
  }, 0);
}

function getGeneratedBillCount(row = {}) {
  return Number(row?.total_bill_generated_count || 0);
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return String(value || "").trim();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthNumber(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const index = MONTH_NAMES.findIndex((month) => month.toLowerCase() === normalized);
  return index < 0 ? 0 : index + 1;
}

function normalizeMonthDateRange(body = {}) {
  const hasExplicitStart = body.start_date || body.startDate || body.from_date || body.from;
  const hasExplicitEnd = body.end_date || body.endDate || body.to_date || body.to;
  const startMonth = monthNumber(body.startMonth);
  const endMonth = monthNumber(body.endMonth);
  const startYear = Number(body.startYear);
  const endYear = Number(body.endYear || body.startYear);

  if (
    hasExplicitStart || hasExplicitEnd || !startMonth || !endMonth ||
    !Number.isInteger(startYear) || !Number.isInteger(endYear) ||
    startYear < 1900 || endYear < 1900
  ) {
    return { ...body };
  }

  const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
  if (start > end) return { ...body };

  return { ...body, start_date: start, end_date: end };
}

async function fetchDepartmentDivisions(departmentId = "") {
  const dep = String(departmentId || "").trim();
  if (!dep) return [];
  const response = await getDivisionsByDepartment({
    department_id: dep,
    departmentId: dep,
  });
  const divisions = response?.divisions;
  return Array.isArray(divisions) ? divisions : [];
}

async function fetchDepartmentDivisionsCached(departmentId = "", log = null) {
  const dep = String(departmentId || "").trim();
  if (!dep) return [];
  const ttl = normalizeTtl(MASTER_CACHE_TTL_SECONDS);
  if (!ttl) return fetchDepartmentDivisions(dep);

  const { value } = await cachedJson({
    prefix: "report:bcs:master:divisions:v2",
    keyPayload: { department_id: dep },
    ttlSeconds: ttl,
    loader: () => fetchDepartmentDivisions(dep),
    log,
  });
  return Array.isArray(value) ? value : [];
}

async function resolveCustomerCountForScope({
  body,
  department_id,
  division_id = "",
  collection_center_id = "",
  scheme_id = "",
  log = null,
}) {
  try {
    const requestPayload = {
      department_id,
      division_id,
      collection_center_id,
      scheme_id,
      revenue_unit_id: body.revenue_unit_id || body.revenueUnitId || "",
      ledger_id: body.ledger_id || body.ledgerId || "",
      lane_id: body.lane_id || body.laneId || "",
    };
    const ttl = normalizeTtl(COUNT_CACHE_TTL_SECONDS);
    const conn = ttl
      ? (
          await cachedJson({
            prefix: "report:bcs:conn-count:v2",
            keyPayload: requestPayload,
            ttlSeconds: ttl,
            loader: () => getConnectionCountSummary(requestPayload),
            log,
          })
        ).value
      : await getConnectionCountSummary(requestPayload);
    const rows = Array.isArray(conn?.rows) ? conn.rows : [];
    return sumConnectionRows(rows);
  } catch {
    return 0;
  }
}

async function fetchSchemesByScope({ department_id = "", division_id = "" }) {
  try {
    const out = await getSchemes({
      department_id,
      departmentId: department_id,
      division_id,
      divisionId: division_id,
    });
    const rows = Array.isArray(out?.schemes) ? out.schemes : [];
    return rows.map((s) => ({
      id: String(s?.id || "").trim(),
      title: String(s?.title || "").trim(),
    }));
  } catch {
    return [];
  }
}

async function fetchSchemesByScopeCached(
  { department_id = "", division_id = "" },
  log = null
) {
  const dep = String(department_id || "").trim();
  const div = String(division_id || "").trim();
  const ttl = normalizeTtl(MASTER_CACHE_TTL_SECONDS);
  if (!ttl) return fetchSchemesByScope({ department_id: dep, division_id: div });

  const { value } = await cachedJson({
    prefix: "report:bcs:master:schemes:v2",
    keyPayload: { department_id: dep, division_id: div },
    ttlSeconds: ttl,
    loader: () => fetchSchemesByScope({ department_id: dep, division_id: div }),
    log,
  });
  return Array.isArray(value) ? value : [];
}

async function fetchCollectionCentersByScope({
  department_id = "",
  division_id = "",
}) {
  try {
    const out = await getCollectionCenters({
      department_id,
      departmentId: department_id,
      division_id,
      divisionId: division_id,
    });
    const rows = Array.isArray(out?.collectionCenters) ? out.collectionCenters : [];
    return rows.map((c) => ({
      id: String(c?.id || "").trim(),
      title: String(c?.title || "").trim(),
    }));
  } catch {
    return [];
  }
}

async function fetchCollectionCentersByScopeCached(
  { department_id = "", division_id = "" },
  log = null
) {
  const dep = String(department_id || "").trim();
  const div = String(division_id || "").trim();
  const ttl = normalizeTtl(MASTER_CACHE_TTL_SECONDS);
  if (!ttl) {
    return fetchCollectionCentersByScope({ department_id: dep, division_id: div });
  }

  const { value } = await cachedJson({
    prefix: "report:bcs:master:centers:v2",
    keyPayload: { department_id: dep, division_id: div },
    ttlSeconds: ttl,
    loader: () =>
      fetchCollectionCentersByScope({ department_id: dep, division_id: div }),
    log,
  });
  return Array.isArray(value) ? value : [];
}

async function buildBillCollectionSummaryResponse(body = {}, options = {}) {
  const department_id = body.department_id || body.departmentId || body.department || "";
  const division_id = body.division_id || body.divisionId || body.division || "";
  const collection_center_id =
    body.collection_center_id || body.collectionCenterId || body.collection_center || body.collectionCenter || "";
  const scheme_id = body.scheme_id || body.schemeId || body.scheme || "";
  const groupByDivision =
    body.group_by_division ?? body.groupByDivision ?? true;
  const groupByCollectionCenter =
    body.group_by_collection_center ?? body.groupByCollectionCenter ?? true;
  const groupByScheme = body.group_by_scheme ?? body.groupByScheme ?? true;
  const log = options?.log || null;
  const responseTtl = normalizeTtl(RESPONSE_CACHE_TTL_SECONDS);

  if (!options?.skipResponseCache && responseTtl > 0) {
    const { value } = await cachedJson({
      prefix: "report:bcs:response:v2",
      keyPayload: {
        body,
        includeMeta: Boolean(options?.includeMeta),
        cacheScope: String(options?.cacheScope || "").trim(),
      },
      ttlSeconds: responseTtl,
      loader: () =>
        buildBillCollectionSummaryResponse(body, {
          ...options,
          skipResponseCache: true,
        }),
      log,
    });
    return value;
  }

  try {
    const rootConnectionPayload = {
      department_id,
      division_id,
      collection_center_id,
      scheme_id,
      revenue_unit_id: body.revenue_unit_id || body.revenueUnitId || "",
      ledger_id: body.ledger_id || body.ledgerId || "",
      lane_id: body.lane_id || body.laneId || "",
    };

    const [billingSummary, connectionSummary] = await Promise.all([
      cachedJson({
        prefix: "report:bcs:billing-summary:v2",
        keyPayload: body,
        ttlSeconds: normalizeTtl(RESPONSE_CACHE_TTL_SECONDS),
        loader: () => fetchBillCollectionSummary(body),
        log,
      }).then((r) => r.value),
      normalizeTtl(COUNT_CACHE_TTL_SECONDS)
        ? cachedJson({
            prefix: "report:bcs:conn-count:v2",
            keyPayload: rootConnectionPayload,
            ttlSeconds: normalizeTtl(COUNT_CACHE_TTL_SECONDS),
            loader: () => getConnectionCountSummary(rootConnectionPayload),
            log,
          }).then((r) => r.value)
        : getConnectionCountSummary(rootConnectionPayload),
    ]);

    const connectionRows = Array.isArray(connectionSummary?.rows) ? connectionSummary.rows : [];
    const totalConsumersFromConnection = sumConnectionRows(connectionRows);
    const billedConsumersCount = Number(billingSummary?.data?.billed_consumers_count || 0);
    const pendingBillNotGeneratedCount = Math.max(
      totalConsumersFromConnection - billedConsumersCount,
      0
    );
    const billCycle = Number(billingSummary?.data?.bill_month_count || 0);
    const divisionWise = Array.isArray(billingSummary?.data?.division_wise)
      ? billingSummary.data.division_wise
      : [];
    const collectionCenterWise = Array.isArray(
      billingSummary?.data?.collection_center_wise
    )
      ? billingSummary.data.collection_center_wise
      : [];
    const schemeWise = Array.isArray(billingSummary?.data?.scheme_wise)
      ? billingSummary.data.scheme_wise
      : [];
    let divisionWiseDetails = [];
    if (groupByDivision) {
      const hasDivisionFilter = Boolean(division_id);
      const billingDivisionMap = new Map(
        divisionWise.map((row) => [String(row?.division_id || "").trim(), row])
      );

      let targetDivisions = [];
      if (hasDivisionFilter) {
        targetDivisions = [{ _id: division_id, name: body.division || "" }];
      } else {
        try {
          const allDivisions = await fetchDepartmentDivisionsCached(
            department_id,
            log
          );
          targetDivisions = allDivisions.map((d) => ({
            _id: String(d?.id || d?._id || "").trim(),
            name: String(d?.name || "").trim(),
          }));
        } catch {
          // Fallback to billed divisions only if admin division list is unavailable.
          targetDivisions = divisionWise.map((row) => ({
            _id: String(row?.division_id || "").trim(),
            name: String(row?.division_name || "").trim(),
          }));
        }
      }

      divisionWiseDetails = await Promise.all(
        targetDivisions
          .filter((d) => d?._id)
          .sort((a, b) => {
            const aCount = getGeneratedBillCount(
              billingDivisionMap.get(String(a?._id || "").trim()) || {}
            );
            const bCount = getGeneratedBillCount(
              billingDivisionMap.get(String(b?._id || "").trim()) || {}
            );
            if (aCount > 0 && bCount <= 0) return -1;
            if (aCount <= 0 && bCount > 0) return 1;
            return bCount - aCount;
          })
          .map(async (division) => {
            const rowDivisionId = String(division._id || "").trim();
            const rowDivisionName = String(division.name || "").trim();
            const billRow = billingDivisionMap.get(rowDivisionId) || {};
            const divisionCustomerCount = await resolveCustomerCountForScope({
              body,
              department_id,
              division_id: rowDivisionId,
              collection_center_id,
              scheme_id,
              log,
            });

            const billedCustomers = Number(billRow?.billed_consumers_count || 0);
            return {
              division_id: rowDivisionId,
              division_name: rowDivisionName || String(billRow?.division_name || ""),
              total_customers: divisionCustomerCount,
              total_billed_customers: billedCustomers,
              pending_bill_generation_count: Math.max(divisionCustomerCount - billedCustomers, 0),
              bill_months: Array.isArray(billRow?.bill_months)
                ? billRow.bill_months
                : [],
            };
          })
      );
    }

    let collectionCenterWiseDetails = [];
    if (groupByCollectionCenter) {
      const billingCollectionCenterMap = new Map();
      for (const row of collectionCenterWise) {
        const id = normalizeId(row?.collection_center_id);
        if (!id) continue;
        const existing = billingCollectionCenterMap.get(id) || {};
        billingCollectionCenterMap.set(id, {
          ...existing,
          ...row,
          collection_center_name: normalizeName(
            row?.collection_center_name || existing?.collection_center_name
          ),
        });
      }
      const centerMasterList = await fetchCollectionCentersByScopeCached(
        {
          department_id,
          division_id,
        },
        log
      );
      const centerNameById = new Map(
        centerMasterList
          .map((c) => [normalizeId(c?.id), normalizeName(c?.title)])
          .filter(([id]) => Boolean(id))
      );
      const targetCollectionCenters = [...billingCollectionCenterMap.keys()].map((id) => ({
        collection_center_id: id,
        collection_center_name:
          centerNameById.get(id) ||
          normalizeName(billingCollectionCenterMap.get(id)?.collection_center_name),
      }));
      if (
        collection_center_id &&
        !targetCollectionCenters.some(
          (c) =>
            String(c?.collection_center_id || "").trim() ===
            String(collection_center_id).trim()
        )
      ) {
        targetCollectionCenters.push({
          collection_center_id: String(collection_center_id).trim(),
          collection_center_name: String(
            body.collection_center || body.collectionCenter || ""
          ).trim(),
        });
      }

      collectionCenterWiseDetails = await Promise.all(
        targetCollectionCenters
          .filter((row) => String(row?.collection_center_id || "").trim())
          .sort((a, b) => {
            const aCount = getGeneratedBillCount(
              billingCollectionCenterMap.get(String(a?.collection_center_id || "").trim()) || {}
            );
            const bCount = getGeneratedBillCount(
              billingCollectionCenterMap.get(String(b?.collection_center_id || "").trim()) || {}
            );
            if (aCount > 0 && bCount <= 0) return -1;
            if (aCount <= 0 && bCount > 0) return 1;
            return bCount - aCount;
          })
          .map(async (row) => {
            const rowCollectionCenterId = String(row?.collection_center_id || "").trim();
            const billRow =
              billingCollectionCenterMap.get(rowCollectionCenterId) || row || {};
            const resolvedName =
              centerNameById.get(rowCollectionCenterId) ||
              normalizeName(
                billRow?.collection_center_name || row?.collection_center_name || ""
              );
            const customerCount = await resolveCustomerCountForScope({
              body,
              department_id,
              division_id,
              collection_center_id: rowCollectionCenterId,
              scheme_id,
              log,
            });
            const billedCustomers = Number(billRow?.billed_consumers_count || 0);
            return {
              collection_center_id: rowCollectionCenterId,
              collection_center_name: resolvedName,
              total_customers: customerCount,
              total_billed_customers: billedCustomers,
              pending_bill_generation_count: Math.max(customerCount - billedCustomers, 0),
              bill_months: Array.isArray(billRow?.bill_months)
                ? billRow.bill_months
                : [],
            };
          })
      );
    }

    let schemeWiseDetails = [];
    if (groupByScheme) {
      const billingSchemeMap = new Map();
      for (const row of schemeWise) {
        const id = normalizeId(row?.scheme_id);
        if (!id) continue;
        const existing = billingSchemeMap.get(id) || {};
        billingSchemeMap.set(id, {
          ...existing,
          ...row,
          scheme_name: normalizeName(row?.scheme_name || existing?.scheme_name),
        });
      }
      const schemeMasterList = await fetchSchemesByScopeCached(
        { department_id, division_id },
        log
      );
      const schemeNameById = new Map(
        schemeMasterList
          .map((s) => [normalizeId(s?.id), normalizeName(s?.title)])
          .filter(([id]) => Boolean(id))
      );
      const targetSchemes = [...billingSchemeMap.keys()].map((id) => ({
        scheme_id: id,
        scheme_name: schemeNameById.get(id) || normalizeName(billingSchemeMap.get(id)?.scheme_name),
      }));
      if (scheme_id && !targetSchemes.some((s) => String(s?.scheme_id || "").trim() === String(scheme_id).trim())) {
        targetSchemes.push({
          scheme_id: String(scheme_id).trim(),
          scheme_name: String(body.scheme || "").trim(),
        });
      }

      schemeWiseDetails = await Promise.all(
        targetSchemes
          .filter((row) => String(row?.scheme_id || "").trim())
          .sort((a, b) => {
            const aCount = getGeneratedBillCount(
              billingSchemeMap.get(String(a?.scheme_id || "").trim()) || {}
            );
            const bCount = getGeneratedBillCount(
              billingSchemeMap.get(String(b?.scheme_id || "").trim()) || {}
            );
            if (aCount > 0 && bCount <= 0) return -1;
            if (aCount <= 0 && bCount > 0) return 1;
            return bCount - aCount;
          })
          .map(async (row) => {
            const rowSchemeId = String(row?.scheme_id || "").trim();
            const billRow = billingSchemeMap.get(rowSchemeId) || row || {};
            const resolvedSchemeName =
              schemeNameById.get(rowSchemeId) ||
              normalizeName(billRow?.scheme_name || row?.scheme_name || "");
            const customerCount = await resolveCustomerCountForScope({
              body,
              department_id,
              division_id,
              collection_center_id,
              scheme_id: rowSchemeId,
              log,
            });
            const billedCustomers = Number(billRow?.billed_consumers_count || 0);
            return {
              scheme_id: rowSchemeId,
              scheme_name: resolvedSchemeName,
              total_customers: customerCount,
              total_billed_customers: billedCustomers,
              pending_bill_generation_count: Math.max(customerCount - billedCustomers, 0),
              bill_months: Array.isArray(billRow?.bill_months)
                ? billRow.bill_months
                : [],
            };
          })
      );
    }

    const merged = {
      success: Boolean(billingSummary?.success),
      message: billingSummary?.message || "Bill collection summary generated successfully",
      filters: billingSummary?.filters || {},
      data: {
        total_customers: totalConsumersFromConnection,
        total_billed_customers: billedConsumersCount,
        pending_bill_generation_count: pendingBillNotGeneratedCount,
        ...(groupByDivision ? { division_wise_details: divisionWiseDetails } : {}),
        ...(groupByCollectionCenter
          ? { collection_center_wise_details: collectionCenterWiseDetails }
          : {}),
        ...(groupByScheme ? { scheme_wise_details: schemeWiseDetails } : {}),
      },
      ...(options?.includeMeta ? { _meta: { bill_cycle: billCycle } } : {}),
    };
    return merged;
  } catch (err) {
    err.message = err?.message || String(err);
    throw err;
  }
}

async function createBillCollectionSummaryHandler(req, reply) {
  try {
    const body = normalizeMonthDateRange(req.body || {});
    const merged = await buildBillCollectionSummaryResponse(body, {
      cacheScope: `${req.user?.id || req.user?._id || ""}:${req.user?.role_id || ""}`,
      log: req.log,
    });
    return reply.send({ ok: true, data: merged });
  } catch (err) {
    req.log.error({ err }, "bill-collection-summary-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch bill collection summary report",
      error: err?.message || String(err),
    });
  }
}

async function createBillCollectionSummaryPdfHandler(req, reply) {
  try {
    const body = normalizeMonthDateRange(req.body || {});
    const merged = await buildBillCollectionSummaryResponse(body, {
      includeMeta: true,
      cacheScope: `${req.user?.id || req.user?._id || ""}:${req.user?.role_id || ""}`,
      log: req.log,
    });
    const pdf = await createBillCollectionSummaryPdf({
      data: merged?.data || {},
      billCycle: Number(merged?._meta?.bill_cycle || 0),
      department:
        body?.departmentId ||
        body?.department_id ||
        body?.department ||
        merged?.filters?.departmentId ||
        merged?.filters?.department_id ||
        merged?.filters?.department,
    });
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename=\"bill-collection-summary-report-${ts}.pdf\"`
    );
    return reply.send(pdf);
  } catch (err) {
    req.log.error({ err }, "bill-collection-summary-report-pdf failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch bill collection summary report pdf",
      error: err?.message || String(err),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/bill-collection-summary-report",
    {
      ...authRoute(
        {
          tags: ["Billing Report"],
          body: reportBody,
        },
        "Billing Report"
      ),
    },
    createBillCollectionSummaryHandler
  );

  fastify.post(
    "/bill-collection-summary-report-pdf",
    {
      ...authRoute(
        {
          tags: ["Billing Report"],
          body: reportBody,
        },
        "Billing Report"
      ),
    },
    createBillCollectionSummaryPdfHandler
  );
}

export default fp(routes);
