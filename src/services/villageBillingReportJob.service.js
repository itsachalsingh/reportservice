import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import XLSX from "@e965/xlsx";
import { getVillageBillingReport } from "./villageBillingReport.service.js";

const schema = new mongoose.Schema({ owner: { type: String, required: true }, query: mongoose.Schema.Types.Mixed,
  status: { type: String, default: "queued" }, lease: Date, token: String, result: mongoose.Schema.Types.ObjectId,
  error: String }, { timestamps: true });
schema.index({ status: 1, lease: 1, createdAt: 1 });
const Job = mongoose.models.VillageBillingReportJob || mongoose.model("VillageBillingReportJob", schema);
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "villageReportResults" });

export async function createJob(owner, query) {
  const job = await Job.create({ owner, query });
  return { job_id: String(job._id), status: job.status };
}
export async function getJob(owner, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Job.findOne({ _id: id, owner }).lean();
}

export function startWorker(log) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped || mongoose.connection.readyState !== 1) return;
    running = true;
    let heartbeat;
    let job;
    const token = randomUUID();
    try {
      job = await Job.findOneAndUpdate({ $or: [{ status: "queued" }, { status: "running", lease: { $lt: new Date() } }] },
        { $set: { status: "running", token, lease: new Date(Date.now() + 120000) } },
        { sort: { createdAt: 1 }, new: true }).lean();
      if (!job) return;
      heartbeat = setInterval(() => Job.updateOne({ _id: job._id, token },
        { $set: { lease: new Date(Date.now() + 120000) } }).catch(err => log.error({ err }, "Village report lease renewal failed")), 30000);
      heartbeat.unref();
      const data = await getVillageBillingReport(job.query);
      let payload = Buffer.from(JSON.stringify(data));
      if (job.query.format === "xlsx") {
        const workbook = XLSX.utils.book_new();
        for (const [name, rows] of Object.entries({ Summary: [data.summary], Villages_Urban: data.rows,
          Divisions: data.division_wise, Areas: data.area_wise, Schemes: data.scheme_wise,
          Collection_Centers: data.collection_center_wise, Billing_Cycles: data.billing_cycle_wise, Consumers: data.consumers })) {
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows || []), name);
        }
        payload = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      }
      const files = bucket();
      const upload = files.openUploadStream(String(job._id), { metadata: { jobId: job._id } });
      await new Promise((resolve, reject) => { upload.on("error", reject).on("finish", resolve); upload.end(payload); });
      const updated = await Job.updateOne({ _id: job._id, token }, { $set: { status: "completed", result: upload.id }, $unset: { lease: 1, token: 1 } });
      if (!updated.modifiedCount) await files.delete(upload.id);
    } catch (err) {
      log.error({ err }, "Village report job failed");
      if (job) await Job.updateOne({ _id: job._id, token }, { $set: { status: "failed", error: "Unable to generate the billing report. Please retry." },
        $unset: { lease: 1, token: 1 } }).catch(error => log.error({ err: error }, "Village report failure update failed"));
    } finally { clearInterval(heartbeat); running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 2000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
export function resultStream(id) { return bucket().openDownloadStream(id); }
