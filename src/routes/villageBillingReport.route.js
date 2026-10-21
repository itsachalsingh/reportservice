import fp from "fastify-plugin";
import XLSX from "@e965/xlsx";
import * as jobs from "../services/villageBillingReportJob.service.js";
import { getVillageBillingReport } from "../services/villageBillingReport.service.js";

const querySchema = { type: "object", required: ["department_id"], properties: {
  department_id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
  division_id: { type: "string", pattern: "^([a-fA-F0-9]{24}|[Aa][Ll][Ll])?$" },
  scheme_id: { type: "string", pattern: "^([a-fA-F0-9]{24}|[Aa][Ll][Ll])?$" },
  collection_center_id: { type: "string", pattern: "^([a-fA-F0-9]{24}|[Aa][Ll][Ll])?$" },
  area_type: { type: "string", enum: ["", "all", "ALL", "Urban", "Rural", "urban", "rural"] },
  consumer_status: { type: "string", enum: ["", "all", "ALL", "Active", "Disconnected", "active", "disconnected"] },
  start_month: { type: "string", pattern: "^(|\\d{4}-(0[1-9]|1[0-2]))$" },
  end_month: { type: "string", pattern: "^(|\\d{4}-(0[1-9]|1[0-2]))$" },
  include_consumers: { type: "boolean", default: false },
  billing_status: { type: "string", enum: ["all", "billed", "unbilled"], default: "all" },
  format: { type: "string", enum: ["json", "xlsx"], default: "json" },
  background: { type: "boolean", default: true },
} };
const ownerOf = req => String(req.user?.id || req.user?._id || req.user?.sub || "");
const noStore = reply => reply.header("Cache-Control", "no-store");

async function routes(fastify, { authRoute }) {
  const stopWorker = jobs.startWorker(fastify.log);
  fastify.addHook("onClose", async () => stopWorker());
  fastify.get("/village-billing-report/jobs/:id", authRoute({}, "Reports"), async (req, reply) => {
    noStore(reply);
    const owner = ownerOf(req);
    if (!owner) return reply.code(401).send({ message: "Authentication required" });
    const job = await jobs.getJob(owner, req.params.id);
    if (!job) return reply.code(404).send({ message: "Report job not found" });
    return { success: true, job_id: String(job._id), status: job.status, message: job.error };
  });
  fastify.get("/village-billing-report/jobs/:id/result", authRoute({}, "Reports"), async (req, reply) => {
    noStore(reply);
    const owner = ownerOf(req);
    if (!owner) return reply.code(401).send({ message: "Authentication required" });
    const job = await jobs.getJob(owner, req.params.id);
    if (!job) return reply.code(404).send({ message: "Report job not found" });
    if (job.status !== "completed") return reply.code(409).send({ status: job.status, message: job.error || "Report is not ready" });
    if (job.query.format === "xlsx") return reply.header("Content-Disposition", "attachment; filename=\"village-billing-report.xlsx\"")
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(jobs.resultStream(job.result));
    return reply.type("application/json").send(jobs.resultStream(job.result));
  });
  fastify.get("/village-billing-report", authRoute({ querystring: querySchema }, "Reports"), async (req, reply) => {
    noStore(reply);
    const query = req.query;
    if (Boolean(query.start_month) !== Boolean(query.end_month) || query.start_month > query.end_month) {
      return reply.code(400).send({ code: "INVALID_BILLING_PERIOD", message: "Provide both start_month and end_month in chronological order." });
    }
    if (query.background) {
      const owner = ownerOf(req);
      if (!owner) return reply.code(401).send({ message: "Authentication required" });
      const job = await jobs.createJob(owner, query);
      return reply.code(202).send({ success: true, ...job });
    }
    try {
      const data = await getVillageBillingReport(query);
      if (query.format === "xlsx") {
        const workbook = XLSX.utils.book_new();
        for (const [name, rows] of Object.entries({ Summary: [data.summary], Villages_Urban: data.rows,
          Divisions: data.division_wise, Areas: data.area_wise, Schemes: data.scheme_wise,
          Collection_Centers: data.collection_center_wise, Billing_Cycles: data.billing_cycle_wise, Consumers: data.consumers })) {
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows || []), name);
        }
        return reply.header("Content-Disposition", "attachment; filename=\"village-billing-report.xlsx\"")
          .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
      }
      return { success: true, data };
    } catch (error) {
      req.log.error({ err: error }, "Village billing report failed");
      return reply.code(503).send({ code: "VILLAGE_REPORT_FAILED", message: "Unable to load village billing report. Please retry.", request_id: req.id });
    }
  });
}
export default fp(routes);
