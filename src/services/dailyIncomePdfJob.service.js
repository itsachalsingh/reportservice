import fs from "fs";
import path from "path";
import DailyIncomePdfJob from "../models/dailyIncomePdfJob.model.js";
import {
  buildDailyIncomePayload,
  EXPORT_JOB_QUERY_MAX_TIME_MS,
  EXPORT_JOB_RPC_TIMEOUT_MS,
  generateDailyIncomePdfBuffer,
} from "./dailyIncomeReport.service.js";

const inFlightJobs = new Set();
const JOBS_DIR = path.resolve(
  process.env.DAILY_INCOME_EXPORT_DIR ||
    path.join(process.cwd(), "storage", "daily-income-pdf-jobs")
);

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureJobsDir() {
  await fs.promises.mkdir(JOBS_DIR, { recursive: true });
  return JOBS_DIR;
}

function buildFileName(jobId) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const safeJobId = sanitizeFileName(jobId);
  return `daily-income-report-${safeJobId}-${ts}.pdf`;
}

export function buildDailyIncomePdfJobDownloadPath(jobId) {
  return `/api/daily-income-report-pdf/jobs/${encodeURIComponent(
    String(jobId)
  )}/download`;
}

async function removeJobFile(filePath, logger) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      logger?.warn?.({ err, filePath }, "Failed to remove daily income job file");
    }
  }
}

export async function runDailyIncomePdfJob(jobId, logger) {
  const id = String(jobId);
  if (!id || inFlightJobs.has(id)) return;
  inFlightJobs.add(id);

  try {
    const job = await DailyIncomePdfJob.findById(id).lean();
    if (!job || !["queued", "running"].includes(job.status)) return;

    await DailyIncomePdfJob.findByIdAndUpdate(id, {
      status: "running",
      startedAt: job.startedAt || new Date(),
      finishedAt: null,
      error: null,
    });

    const payload = buildDailyIncomePayload(job.payload || {});
    const { pdf, totalRecords } = await generateDailyIncomePdfBuffer(payload, {
      rpcTimeoutMs: EXPORT_JOB_RPC_TIMEOUT_MS,
      queryMaxTimeMs: EXPORT_JOB_QUERY_MAX_TIME_MS,
    });

    const jobsDir = await ensureJobsDir();
    const fileName = buildFileName(id);
    const filePath = path.join(jobsDir, fileName);

    await removeJobFile(job.filePath, logger);
    await fs.promises.writeFile(filePath, pdf);

    await DailyIncomePdfJob.findByIdAndUpdate(id, {
      status: "completed",
      finishedAt: new Date(),
      totalRecords,
      fileName,
      filePath,
      contentType: "application/pdf",
      error: null,
    });
  } catch (err) {
    logger?.error?.({ err, jobId: id }, "runDailyIncomePdfJob failed");
    await DailyIncomePdfJob.findByIdAndUpdate(id, {
      status: "failed",
      finishedAt: new Date(),
      error: err?.message || "Daily income PDF job failed",
    }).catch(() => {});
  } finally {
    inFlightJobs.delete(id);
  }
}

export function enqueueDailyIncomePdfJob(jobId, logger) {
  setImmediate(() => {
    runDailyIncomePdfJob(jobId, logger).catch(() => {});
  });
}

export async function resumePendingDailyIncomePdfJobs(logger) {
  const jobs = await DailyIncomePdfJob.find({
    status: { $in: ["queued", "running"] },
  })
    .select("_id")
    .lean();

  for (const job of jobs) {
    enqueueDailyIncomePdfJob(job._id, logger);
  }
}
