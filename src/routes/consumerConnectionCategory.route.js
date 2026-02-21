import fp from "fastify-plugin";
import { getConnectionCategorySummary } from "../utils/grpc/connectionClient.js";
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
    location: { type: "string" },
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

  if (!department_id || !division_id) {
    return reply.code(400).send({
      ok: false,
      message:
        "department and division are required (use *_id or name)",
    });
  }

  try {
    const data = await getConnectionCategorySummary({
      department_id,
      division_id,
      collection_center_id,
      scheme_id,
      location,
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
    return reply.code(500).send({
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
