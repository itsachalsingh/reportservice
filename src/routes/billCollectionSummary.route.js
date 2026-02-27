import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { getConnectionCountSummary } from "../utils/grpc/connectionClient.js";
import { getDivisionsByDepartment } from "../utils/grpc/divisionClient.js";

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

async function createBillCollectionSummaryHandler(req, reply) {
  const body = req.body || {};
  const department_id = body.department_id || body.departmentId || body.department || "";
  const division_id = body.division_id || body.divisionId || body.division || "";
  const collection_center_id =
    body.collection_center_id || body.collectionCenterId || body.collection_center || body.collectionCenter || "";
  const scheme_id = body.scheme_id || body.schemeId || body.scheme || "";

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
    const totalBillsGenerated = Number(
      billingSummary?.data?.total_bill_generated_count || 0
    );
    const totalGeneratedAmount = Number(
      billingSummary?.data?.total_bill_generated_value || 0
    );
    const totalCollectedAmount = Number(
      billingSummary?.data?.total_bill_collected || 0
    );
    const totalPendingAmount = Number(
      billingSummary?.data?.total_bill_remaining || 0
    );
    const billMonths = Array.isArray(billingSummary?.data?.bill_months)
      ? billingSummary.data.bill_months
      : [];
    const billMonthCount = Number(billingSummary?.data?.bill_month_count || 0);
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
            total_bills_generated: Number(billRow?.total_bill_generated_count || 0),
            total_billed_customers: billedCustomers,
            pending_bill_generation_count: Math.max(divisionCustomerCount - billedCustomers, 0),
            total_generated_amount: Number(billRow?.total_bill_generated_value || 0),
            total_collected_amount: Number(billRow?.total_bill_collected || 0),
            total_pending_amount: Number(billRow?.total_bill_remaining || 0),
          };
        })
    );

    const billingCollectionCenterMap = new Map(
      collectionCenterWise.map((row) => [String(row?.collection_center_id || "").trim(), row])
    );
    const targetCollectionCenters = [...collectionCenterWise];
    if (
      collection_center_id &&
      !billingCollectionCenterMap.has(String(collection_center_id).trim())
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
            total_bills_generated: Number(billRow?.total_bill_generated_count || 0),
            total_billed_customers: billedCustomers,
            pending_bill_generation_count: Math.max(customerCount - billedCustomers, 0),
            total_generated_amount: Number(billRow?.total_bill_generated_value || 0),
            total_collected_amount: Number(billRow?.total_bill_collected || 0),
            total_pending_amount: Number(billRow?.total_bill_remaining || 0),
          };
        })
    );

    const billingSchemeMap = new Map(
      schemeWise.map((row) => [String(row?.scheme_id || "").trim(), row])
    );
    const targetSchemes = [...schemeWise];
    if (scheme_id && !billingSchemeMap.has(String(scheme_id).trim())) {
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
            total_bills_generated: Number(billRow?.total_bill_generated_count || 0),
            total_billed_customers: billedCustomers,
            pending_bill_generation_count: Math.max(customerCount - billedCustomers, 0),
            total_generated_amount: Number(billRow?.total_bill_generated_value || 0),
            total_collected_amount: Number(billRow?.total_bill_collected || 0),
            total_pending_amount: Number(billRow?.total_bill_remaining || 0),
          };
        })
    );

    const merged = {
      success: Boolean(billingSummary?.success),
      message: billingSummary?.message || "Bill collection summary generated successfully",
      filters: billingSummary?.filters || {},
      data: {
        total_customers: totalConsumersFromConnection,
        total_bills_generated: totalBillsGenerated,
        total_billed_customers: billedConsumersCount,
        pending_bill_generation_count: pendingBillNotGeneratedCount,
        total_generated_amount: totalGeneratedAmount,
        total_collected_amount: totalCollectedAmount,
        total_pending_amount: totalPendingAmount,
        bill_months: billMonths,
        bill_month_count: billMonthCount,
        division_wise_details: divisionWiseDetails,
        collection_center_wise_details: collectionCenterWiseDetails,
        scheme_wise_details: schemeWiseDetails,
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
