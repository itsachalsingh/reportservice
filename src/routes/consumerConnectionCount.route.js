import fp from "fastify-plugin";
import { getConnectionCountSummary } from "../utils/grpc/connectionClient.js";
import { renderConnectionCountReportSvg } from "../utils/reportSvg.js";

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
  },
  required: [],
};

const coalesceId = (body, primary, fallback) =>
  body?.[primary] || body?.[fallback] || "";

async function createReportHandler(req, reply) {
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

  if (!department_id) {
    return reply.code(400).send({
      ok: false,
      message: "department is required (use department_id or department)",
    });
  }

  try {
    const data = await getConnectionCountSummary({
      department_id,
      division_id,
      collection_center_id,
      scheme_id,
      revenue_unit_id,
      ledger_id,
      lane_id,
    });

    const rows = Array.isArray(data?.rows) ? data.rows : [];

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
      return reply.send({ ok: true, rows });
    }

    const title = "CONSUMER CATEGORY WISE CONNECTION REPORT";
    const svg = renderConnectionCountReportSvg({
      title,
      rows,
    });

    reply.header("Content-Type", "image/svg+xml");
    return reply.send(svg);
  } catch (err) {
    req.log.error({ err }, "consumer-connection-count-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch consumer connection count report",
      error: err?.message || String(err),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/consumer-connection-count-report",
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
