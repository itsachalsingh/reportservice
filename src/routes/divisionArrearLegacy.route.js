import fp from "fastify-plugin";
import {
  fetchLegacyArrearDivisionSummary,
  getLegacyArrearGrpcTarget,
} from "../utils/grpc/legacyArrearClient.js";
import { getCollectionCenters } from "../utils/grpc/collectionCenterClient.js";
import { getSchemes } from "../utils/grpc/schemeClient.js";
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

function cleanString(value) {
  return String(value || "").trim();
}

function isMissingLabel(value) {
  const text = cleanString(value);
  return !text || text === "-";
}

function looksLikeCode(value) {
  const text = cleanString(value);
  if (!text) return false;
  return /^[0-9]+$/.test(text) || /^[A-Z0-9_-]{2,}$/.test(text);
}

function shouldReplaceLabel(currentLabel, idValue, mappedLabel) {
  const current = cleanString(currentLabel);
  const mapped = cleanString(mappedLabel);
  const id = cleanString(idValue);
  if (!mapped) return false;
  if (isMissingLabel(current)) return true;
  if (id && current === id) return true;
  if (looksLikeCode(current) && mapped && mapped !== current) return true;
  return false;
}

async function enrichGroupingLabels(rows = [], requestBody = {}, filters = {}, grouping = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const departmentId =
    cleanString(requestBody?.department_id) ||
    cleanString(requestBody?.departmentId) ||
    cleanString(requestBody?.department) ||
    cleanString(filters?.department_id) ||
    cleanString(filters?.departmentId) ||
    cleanString(filters?.department);

  const divisionId =
    cleanString(requestBody?.division_id) ||
    cleanString(requestBody?.divisionId) ||
    cleanString(requestBody?.division) ||
    cleanString(filters?.division_id) ||
    cleanString(filters?.divisionId) ||
    cleanString(filters?.division);

  const needsCollectionCenterLabel =
    Boolean(grouping?.by_collection_center) &&
    rows.some((row) => cleanString(row?.collection_center_id) && isMissingLabel(row?.collection_center));
  const needsSchemeLabel =
    Boolean(grouping?.by_scheme) &&
    rows.some((row) => cleanString(row?.scheme_id) && isMissingLabel(row?.scheme));

  if (!needsCollectionCenterLabel && !needsSchemeLabel) return rows;

  const payload = {
    department_id: departmentId,
    departmentId: departmentId,
    division_id: divisionId,
    divisionId: divisionId,
  };

  const [collectionCenterMap, schemeMap] = await Promise.all([
    needsCollectionCenterLabel
      ? getCollectionCenters(payload)
          .then((resp) => {
            const list = Array.isArray(resp?.collectionCenters) ? resp.collectionCenters : [];
            return new Map(
              list.map((item) => [cleanString(item?.id), cleanString(item?.title)])
            );
          })
          .catch(() => new Map())
      : Promise.resolve(new Map()),
    needsSchemeLabel
      ? getSchemes(payload)
          .then((resp) => {
            const list = Array.isArray(resp?.schemes) ? resp.schemes : [];
            return new Map(
              list.map((item) => [cleanString(item?.id), cleanString(item?.title)])
            );
          })
          .catch(() => new Map())
      : Promise.resolve(new Map()),
  ]);

  return rows.map((row) => {
    const collectionCenterId = cleanString(row?.collection_center_id);
    const schemeId = cleanString(row?.scheme_id);
    const mappedCollectionCenter = collectionCenterMap.get(collectionCenterId) || "";
    const mappedScheme = schemeMap.get(schemeId) || "";

    return {
      ...row,
      collection_center:
        shouldReplaceLabel(
          row?.collection_center,
          collectionCenterId,
          mappedCollectionCenter
        )
          ? mappedCollectionCenter
          : row?.collection_center,
      scheme:
        shouldReplaceLabel(row?.scheme, schemeId, mappedScheme)
          ? mappedScheme
          : row?.scheme,
    };
  });
}

async function createDivisionLegacyArrearReport(req, reply) {
  try {
    const data = await fetchLegacyArrearDivisionSummary(req.body || {});
    const enrichedRows = await enrichGroupingLabels(
      Array.isArray(data?.rows) ? data.rows : [],
      req.body || {},
      data?.filters || {},
      data?.grouping || {}
    );
    const out = { ...data, rows: enrichedRows };

    const format = parseFormat(req);
    if (format === "json") {
      return reply.send({
        ok: true,
        data: out,
      });
    }

    const pdf = await createLegacyArrearSummaryPdf({
      rows: enrichedRows,
      totals: out?.totals || {},
      department:
        req.body?.departmentId ||
        req.body?.department_id ||
        req.body?.department ||
        out?.filters?.departmentId ||
        out?.filters?.department_id ||
        out?.filters?.department,
      grouping: out?.grouping || {},
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
    const debug = err?.grpcDebug || null;
    const logPayload = {
      err,
      grpcTarget: getLegacyArrearGrpcTarget(),
      grpcDebug: debug,
      requestBody: req.body || {},
    };
    req.log.error(logPayload, "division-legacy-arrear-report failed");
    console.error("[division-legacy-arrear-report] failed", logPayload);
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
