import fp from "fastify-plugin";
import XLSX from "@e965/xlsx";
import {
  fetchDivisionCollectionBillingSummary,
} from "../utils/grpc/billCollectionSummaryClient.js";
import {
  getDivisionCollectionPaymentSummaryRPC,
} from "../utils/rpcClient.js";
import {
  getDivisionById,
  getDivisionsByDepartment,
} from "../utils/grpc/divisionClient.js";
import {
  buildDivisionCollectionScopes,
  buildDivisionCollectionTotals,
  mergeDivisionCollectionRows,
  resolveDivisionCollectionPeriods,
  toDivisionCollectionSpreadsheetRow,
} from "../services/divisionCollectionReport.service.js";

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
    start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    financial_year: { type: "string" },
    financialYear: { type: "string" },
    fy: { type: "string" },
    as_on_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    asOnDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    include_today: { type: "boolean" },
    includeToday: { type: "boolean" },
  },
};

const EXCEL_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function cleanString(value) {
  return value == null ? "" : String(value).trim();
}

async function fetchMasterDivisions(body = {}) {
  const departmentId = cleanString(
    body?.department_id || body?.departmentId || body?.department
  );
  const divisionId = cleanString(
    body?.division_id || body?.divisionId || body?.division
  );

  try {
    if (divisionId) {
      const response = await getDivisionById(divisionId);
      return response?.division ? [response.division] : [];
    }
    if (departmentId) {
      const response = await getDivisionsByDepartment({
        department_id: departmentId,
        departmentId,
      });
      return Array.isArray(response?.divisions) ? response.divisions : [];
    }
  } catch {
    // Billing snapshots still provide a useful name if master data is unavailable.
  }
  return [];
}

export async function buildDivisionCollectionReport(body = {}) {
  const collectionPeriod = resolveDivisionCollectionPeriods(body);
  const periodRequest = {
    ...body,
    start_date: collectionPeriod.start_date,
    end_date: collectionPeriod.end_date,
  };
  const [billing, masterDivisions] = await Promise.all([
    fetchDivisionCollectionBillingSummary(periodRequest),
    fetchMasterDivisions(body),
  ]);
  if (!billing?.success) {
    throw new Error(
      billing?.message || "Failed to fetch division collection billing summary"
    );
  }

  const billingRows = Array.isArray(billing?.rows) ? billing.rows : [];
  const divisionScopes = buildDivisionCollectionScopes({
    billingRows,
    masterDivisions,
  });
  const paymentRpc = divisionScopes.length
    ? await getDivisionCollectionPaymentSummaryRPC(
        {
          division_scopes: divisionScopes,
          start_date: collectionPeriod.start_date,
          end_date: collectionPeriod.end_date,
          department: body?.department,
          department_id: body?.department_id || body?.departmentId,
        },
        {
          timeoutMs: Number(
            process.env.DIVISION_COLLECTION_REPORT_TIMEOUT_MS || 120000
          ),
        }
      )
    : { ok: true, data: { rows: [] } };

  if (!paymentRpc?.ok) {
    throw new Error(
      paymentRpc?.message || "Failed to fetch division collection payment summary"
    );
  }

  const paymentRows = (Array.isArray(paymentRpc?.data?.rows)
    ? paymentRpc.data.rows
    : []
  ).map((row) => ({
    ...row,
    division_id:
      cleanString(row?.division_id) === "__unassigned__"
        ? ""
        : cleanString(row?.division_id),
  }));
  const rows = mergeDivisionCollectionRows({
    billingRows,
    paymentRows,
    masterDivisions,
  });

  return {
    success: true,
    message: "Division-wise collection report generated successfully",
    latest_bill_per_connection: true,
    latest_bill_scope: "requested_period",
    collection_basis: "completed_transactions_for_selected_latest_bills",
    collection_cutoff_date: collectionPeriod.cutoff_date,
    collection_includes_today: collectionPeriod.includes_today,
    collection_periods: collectionPeriod.periods,
    rows,
    totals: buildDivisionCollectionTotals(rows),
  };
}

function buildExcelBuffer(report = {}) {
  const rows = (report?.rows || []).map(toDivisionCollectionSpreadsheetRow);
  rows.push(
    toDivisionCollectionSpreadsheetRow({
      division_name: "Grand Total",
      ...(report?.totals || {}),
    })
  );

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 32 },
    { wch: 14 },
    { wch: 16 },
    { wch: 19 },
    { wch: 16 },
    { wch: 22 },
    { wch: 40 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Division Collection");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function setNoStore(reply) {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
}

async function reportHandler(req, reply) {
  try {
    setNoStore(reply);
    const report = await buildDivisionCollectionReport(req.body || {});
    return reply.send({ ok: true, data: report });
  } catch (error) {
    req.log.error({ err: error }, "division-wise-collection-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to generate division-wise collection report",
      error: error?.message || String(error),
    });
  }
}

async function excelHandler(req, reply) {
  try {
    setNoStore(reply);
    const report = await buildDivisionCollectionReport(req.body || {});
    const buffer = buildExcelBuffer(report);
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    reply.header("Content-Type", EXCEL_CONTENT_TYPE);
    reply.header(
      "Content-Disposition",
      `attachment; filename="division-wise-collection-report-${timestamp}.xlsx"`
    );
    reply.header("Content-Length", String(buffer.length));
    return reply.send(buffer);
  } catch (error) {
    req.log.error({ err: error }, "division-wise-collection-report-excel failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to generate division-wise collection report Excel",
      error: error?.message || String(error),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;
  const schema = {
    tags: ["Collection Report"],
    body: reportBody,
  };

  fastify.post(
    "/division-wise-collection-report",
    { ...authRoute(schema, "Collection Report") },
    reportHandler
  );
  fastify.post(
    "/division-wise-collection-report-excel",
    { ...authRoute(schema, "Collection Report") },
    excelHandler
  );
}

export default fp(routes);
