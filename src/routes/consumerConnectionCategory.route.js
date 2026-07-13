import fp from "fastify-plugin";
import { getConnectionCategorySummary } from "../utils/grpc/connectionClient.js";
import { getRollingConnectionReportStartDate } from "../utils/connectionReportDateRange.js";
import { renderConnectionCategoryReportSvg } from "../utils/reportSvg.js";

const reportBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    department: { type: "string" },
    department_id: { type: "string" },
    division: { type: "string" },
    division_id: { type: "string" },
    collection_center: { type: "string" },
    collection_center_id: { type: "string" },
    scheme: { type: "string" },
    scheme_id: { type: "string" },
    revenue_unit: { type: "string" },
    revenue_unit_id: { type: "string" },
    ledger: { type: "string" },
    ledger_id: { type: "string" },
    lane: { type: "string" },
    lane_id: { type: "string" },
    location: { type: "string" },
    status: { type: "string" },
    start_date: { type: "string" },
    end_date: { type: "string" },
  },
  required: ["location"],
};

const normalizeLocation = (value) => String(value || "").trim().toLowerCase();
const normalizeCategoryKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const coalesceId = (body, primary, fallback) =>
  body?.[primary] || body?.[fallback] || "";

const EXCLUDED_CONNECTION_CATEGORIES = new Set([
  "total water sewer",
  "total water",
  "total sewer",
  "both",
  "meter",
  "average",
  "tap",
  "assessment",
  "total active connection",
  "total inactive connect",
  "total inactive connection",
]);

function buildTotals(rows) {
  return rows.reduce(
    (acc, row) => ({
      connection_category_id: "",
      connection_category: "Total",
      tax_non: acc.tax_non + Number(row.tax_non || 0),
      total_cd: acc.total_cd + Number(row.total_cd || 0),
      water_c: acc.water_c + Number(row.water_c || 0),
      sewer_c: acc.sewer_c + Number(row.sewer_c || 0),
      both_c: acc.both_c + Number(row.both_c || 0),
      water_d: acc.water_d + Number(row.water_d || 0),
      sewer_d: acc.sewer_d + Number(row.sewer_d || 0),
      both_d: acc.both_d + Number(row.both_d || 0),
    }),
    {
      connection_category_id: "",
      connection_category: "Total",
      tax_non: 0,
      total_cd: 0,
      water_c: 0,
      sewer_c: 0,
      both_c: 0,
      water_d: 0,
      sewer_d: 0,
      both_d: 0,
    }
  );
}

async function createReportHandler(req, reply) {
  const location = normalizeLocation(req.body?.location);
  if (!["rural", "urban", "all"].includes(location)) {
    return reply.code(400).send({
      ok: false,
      message: 'location must be "rural", "urban", or "all"',
    });
  }

  const department_id = coalesceId(req.body, "department_id", "department");
  const division_id = coalesceId(req.body, "division_id", "division");
  const collection_center_id = coalesceId(
    req.body,
    "collection_center_id",
    "collection_center"
  );
  const scheme_id = coalesceId(req.body, "scheme_id", "scheme");
  const revenue_unit_id = coalesceId(req.body, "revenue_unit_id", "revenue_unit");
  const ledger_id = coalesceId(req.body, "ledger_id", "ledger");
  const lane_id = coalesceId(req.body, "lane_id", "lane");
  const status = String(req.body?.status || "").trim().toLowerCase();
  if (status && !["active", "inactive", "closed", "all"].includes(status)) {
    return reply.code(400).send({
      ok: false,
      message: 'status must be "active", "inactive", "closed", or "all"',
    });
  }
  const start_date = getRollingConnectionReportStartDate(
    req.body?.start_date,
    req.body?.end_date
  );
  const end_date = req.body?.end_date || "";

  if (!department_id) {
    return reply.code(400).send({
      ok: false,
      message: "department is required (use department_id or department)",
    });
  }

  try {
    const data = await getConnectionCategorySummary({
      department_id,
      division_id,
      collection_center_id,
      scheme_id,
      revenue_unit_id,
      ledger_id,
      lane_id,
      location,
      status,
      start_date,
      end_date,
    });

    const rows = (Array.isArray(data?.rows) ? data.rows : []).filter(
      (row) =>
        !EXCLUDED_CONNECTION_CATEGORIES.has(
          normalizeCategoryKey(row?.connection_category)
        )
    );
    const hasOverallTotal = rows.some(
      (row) => String(row?.connection_category || "").trim().toLowerCase() === "total"
    );
    const totals = hasOverallTotal ? null : buildTotals(rows);
    const rowsWithTotal = hasOverallTotal
      ? rows
      : rows.length
        ? [...rows, totals]
        : [totals];

    const rawFormat = req.query?.format;
    const acceptHeader = String(req.headers?.accept || "").toLowerCase();
    const inferredFormat =
      rawFormat ||
      (acceptHeader
        ? acceptHeader.includes("application/json")
          ? "json"
          : "image"
        : "json");
    const format = String(inferredFormat).toLowerCase();
    if (format === "json") {
      return reply.send({ ok: true, rows: rowsWithTotal });
    }

    const title =
      "TOTAL CONSUMERS (CONNECTION CATEGORY BASED) LIST ON INDIVIDUAL COLLECTION CENTERS";
    const subtitle = location === "all" ? "LOCATION: ALL" : `LOCATION: ${location.toUpperCase()}`;
    const svg = renderConnectionCategoryReportSvg({
      title,
      subtitle,
      rows: rowsWithTotal,
    });

    reply.header("Content-Type", "image/svg+xml");
    return reply.send(svg);
  } catch (err) {
    req.log.error({ err }, "connection-category-report failed");
    const statusCode = err?.code === 3 ? 400 : 500;
    return reply.code(statusCode).send({
      ok: false,
      message: "Failed to fetch connection category report",
      error: err?.message || String(err),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/consumer-connection-category-report",
    {
      ...authRoute(
        {
          tags: ["Consumer Report"],
          body: reportBody,
        },
        "Consumer Report"
      ),
    },
    createReportHandler
  );
}

export default fp(routes);
