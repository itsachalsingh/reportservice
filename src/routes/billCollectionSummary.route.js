import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { getConnectionCountSummary } from "../utils/grpc/connectionClient.js";
import { getDivisionsByDepartment } from "../utils/grpc/divisionClient.js";
import { getSchemes } from "../utils/grpc/schemeClient.js";
import { getCollectionCenters } from "../utils/grpc/collectionCenterClient.js";

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

function sumConnectionRows(rows = []) {
  return rows.reduce((acc, item) => {
    const active = Number(item?.active || 0);
    const inactive = Number(item?.inactive || 0);
    const rowTotal = active + inactive;
    return acc + (Number.isFinite(rowTotal) ? rowTotal : 0);
  }, 0);
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

async function resolveCustomerCountForScope({
  body,
  department_id,
  division_id = "",
  collection_center_id = "",
  scheme_id = "",
}) {
  try {
    const conn = await getConnectionCountSummary({
      department_id,
      division_id,
      collection_center_id,
      scheme_id,
      revenue_unit_id: body.revenue_unit_id || body.revenueUnitId || "",
      ledger_id: body.ledger_id || body.ledgerId || "",
      lane_id: body.lane_id || body.laneId || "",
    });
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

async function createBillCollectionSummaryHandler(req, reply) {
  const body = req.body || {};
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

  try {
    const [billingSummary, connectionSummary] = await Promise.all([
      fetchBillCollectionSummary(body),
      getConnectionCountSummary({
        department_id,
        division_id,
        collection_center_id,
        scheme_id,
        revenue_unit_id: body.revenue_unit_id || body.revenueUnitId || "",
        ledger_id: body.ledger_id || body.ledgerId || "",
        lane_id: body.lane_id || body.laneId || "",
      }),
    ]);

    const connectionRows = Array.isArray(connectionSummary?.rows) ? connectionSummary.rows : [];
    const totalConsumersFromConnection = sumConnectionRows(connectionRows);
    const billedConsumersCount = Number(billingSummary?.data?.billed_consumers_count || 0);
    const pendingBillNotGeneratedCount = Math.max(
      totalConsumersFromConnection - billedConsumersCount,
      0
    );
    const billMonths = Array.isArray(billingSummary?.data?.bill_months)
      ? billingSummary.data.bill_months
      : [];
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
    const hasDivisionFilter = Boolean(division_id);

    const billingDivisionMap = new Map(
      divisionWise.map((row) => [String(row?.division_id || "").trim(), row])
    );

    let targetDivisions = [];
    if (hasDivisionFilter) {
      targetDivisions = [{ _id: division_id, name: body.division || "" }];
    } else {
      try {
        const allDivisions = await fetchDepartmentDivisions(department_id);
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

    const divisionWiseDetails = await Promise.all(
      targetDivisions
        .filter((d) => d?._id)
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
          });

          const billedCustomers = Number(billRow?.billed_consumers_count || 0);
          return {
            division_id: rowDivisionId,
            division_name: rowDivisionName || String(billRow?.division_name || ""),
            total_customers: divisionCustomerCount,
            total_billed_customers: billedCustomers,
            pending_bill_generation_count: Math.max(divisionCustomerCount - billedCustomers, 0),
            bill_months: billMonths,
          };
        })
    );

    const billingCollectionCenterMap = new Map(
      collectionCenterWise.map((row) => [String(row?.collection_center_id || "").trim(), row])
    );
    const centerMasterList = await fetchCollectionCentersByScope({
      department_id,
      division_id,
    });
    const targetCollectionCenters = centerMasterList.length
      ? centerMasterList.map((c) => ({
          collection_center_id: c.id,
          collection_center_name: c.title,
        }))
      : [...collectionCenterWise];
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

    const collectionCenterWiseDetails = await Promise.all(
      targetCollectionCenters
        .filter((row) => String(row?.collection_center_id || "").trim())
        .map(async (row) => {
          const rowCollectionCenterId = String(row?.collection_center_id || "").trim();
          const billRow =
            billingCollectionCenterMap.get(rowCollectionCenterId) || row || {};
          const customerCount = await resolveCustomerCountForScope({
            body,
            department_id,
            division_id,
            collection_center_id: rowCollectionCenterId,
            scheme_id,
          });
          const billedCustomers = Number(billRow?.billed_consumers_count || 0);
          return {
            collection_center_id: rowCollectionCenterId,
            collection_center_name: String(
              billRow?.collection_center_name || row?.collection_center_name || ""
            ).trim(),
            total_customers: customerCount,
            total_billed_customers: billedCustomers,
            pending_bill_generation_count: Math.max(customerCount - billedCustomers, 0),
            bill_months: billMonths,
          };
        })
    );

    const billingSchemeMap = new Map(
      schemeWise.map((row) => [String(row?.scheme_id || "").trim(), row])
    );
    const schemeMasterList = await fetchSchemesByScope({ department_id, division_id });
    const targetSchemes = schemeMasterList.length
      ? schemeMasterList.map((s) => ({ scheme_id: s.id, scheme_name: s.title }))
      : [...schemeWise];
    if (scheme_id && !targetSchemes.some((s) => String(s?.scheme_id || "").trim() === String(scheme_id).trim())) {
      targetSchemes.push({
        scheme_id: String(scheme_id).trim(),
        scheme_name: String(body.scheme || "").trim(),
      });
    }

    const schemeWiseDetails = await Promise.all(
      targetSchemes
        .filter((row) => String(row?.scheme_id || "").trim())
        .map(async (row) => {
          const rowSchemeId = String(row?.scheme_id || "").trim();
          const billRow = billingSchemeMap.get(rowSchemeId) || row || {};
          const customerCount = await resolveCustomerCountForScope({
            body,
            department_id,
            division_id,
            collection_center_id,
            scheme_id: rowSchemeId,
          });
          const billedCustomers = Number(billRow?.billed_consumers_count || 0);
          return {
            scheme_id: rowSchemeId,
            scheme_name: String(billRow?.scheme_name || row?.scheme_name || "").trim(),
            total_customers: customerCount,
            total_billed_customers: billedCustomers,
            pending_bill_generation_count: Math.max(customerCount - billedCustomers, 0),
            bill_months: billMonths,
          };
        })
    );

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
    };

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
}

export default fp(routes);
