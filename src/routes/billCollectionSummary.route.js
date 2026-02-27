import fp from "fastify-plugin";
import { fetchBillCollectionSummary } from "../utils/grpc/billCollectionSummaryClient.js";
import { getConnectionCountSummary } from "../utils/grpc/connectionClient.js";

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

    const connectionRows = Array.isArray(connectionSummary?.rows)
      ? connectionSummary.rows
      : [];

    const totalConsumersFromConnection = connectionRows.reduce((acc, row) => {
      const active = Number(row?.active || 0);
      const inactive = Number(row?.inactive || 0);
      const rowTotal = active + inactive;
      return acc + (Number.isFinite(rowTotal) ? rowTotal : 0);
    }, 0);
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
      },
      consumer_source: "uwbs-adminservice.connection",
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
