import fp from "fastify-plugin";
import { fetchLegacyArrearDivisionSummary } from "../utils/grpc/legacyArrearClient.js";
import { createLegacyArrearSummaryPdf } from "../utils/legacyArrearPdf.js";

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
    group_by_collection_center: { type: "boolean" },
    groupByCollectionCenter: { type: "boolean" },
    group_by_scheme: { type: "boolean" },
    groupByScheme: { type: "boolean" },
  },
};

function parseFormat(req) {
  const queryFormat = String(req.query?.format || "").trim().toLowerCase();
  const accept = String(req.headers?.accept || "").toLowerCase();
  const format = queryFormat;
  if (format === "pdf") return "pdf";
  if (format === "json") return "json";
  if (accept.includes("application/pdf")) return "pdf";
  return "json";
}

async function createDivisionLegacyArrearReport(req, reply) {
  try {
    const data = await fetchLegacyArrearDivisionSummary(req.body || {});

    const format = parseFormat(req);
    if (format === "json") {
      return reply.send({
        ok: true,
        data,
      });
    }

    const pdf = await createLegacyArrearSummaryPdf({
      rows: Array.isArray(data?.rows) ? data.rows : [],
      totals: data?.totals || {},
      filters: data?.filters || {},
      grouping: data?.grouping || {},
    });

    const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename=\"legacy-arrear-report-${ts}.pdf\"`
    );
    return reply.send(pdf);
  } catch (err) {
    const statusCode = 500;
    const remoteMessage = err?.message || "Failed to fetch report";
    req.log.error({ err }, "division-legacy-arrear-report failed");
    return reply.code(statusCode).send({
      ok: false,
      message: remoteMessage,
      error: null,
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/division-legacy-arrear-report",
    {
      ...authRoute(
        {
          tags: ["Arrear Report"],
          body: reportBody,
          querystring: {
            type: "object",
            properties: {
              format: { type: "string", enum: ["json", "pdf"] },
            },
            additionalProperties: false,
          },
        },
        "Arrear Report"
      ),
    },
    createDivisionLegacyArrearReport
  );
}

export default fp(routes);
