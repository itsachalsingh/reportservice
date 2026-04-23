import fs from "fs";
import fp from "fastify-plugin";
import DailyIncomePdfJob from "../models/dailyIncomePdfJob.model.js";
import {
  buildDailyIncomePayload,
  generateDailyIncomePdfBuffer,
  paymentModes,
  transactionStatuses,
  transactionTypes,
} from "../services/dailyIncomeReport.service.js";
import {
  buildDailyIncomePdfJobDownloadPath,
  enqueueDailyIncomePdfJob,
} from "../services/dailyIncomePdfJob.service.js";
import { getDailyIncomeReportRPC } from "../utils/rpcClient.js";

const transactionTypeFilterValues = [...transactionTypes, ""];

const dailyIncomeBody = {
  type: "object",
  required: ["start_date", "end_date"],
  additionalProperties: false,
  properties: {
    start_date: { type: "string", format: "date" },
    end_date: { type: "string", format: "date" },
    fromDate: { type: "string", format: "date" },
    toDate: { type: "string", format: "date" },
    report_title: { type: "string" },
    collection_center: { type: "string" },
    collection_center_id: { type: "string" },
    collectionCenter: { type: "string" },
    division: { type: "string" },
    division_id: { type: "string" },
    scheme: { type: "string" },
    scheme_id: { type: "string" },
    department: { type: "string" },
    department_id: { type: "string" },
    department_name: { type: "string" },
    district_id: { type: "string" },
    ward_id: { type: "string" },
    revenue_unit_id: { type: "string" },
    ledger_id: { type: "string" },
    lane_id: { type: "string" },
    page: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: 500 },
    area_type: { type: "string", enum: ["urban", "rural", "all"] },
    payment_methods: {
      oneOf: [
        {
          type: "array",
          items: { type: "string", enum: paymentModes },
          minItems: 0,
        },
        { type: "string", enum: paymentModes },
        { type: "null" },
      ],
    },
    payment_method: {
      anyOf: [{ type: "string", enum: paymentModes }, { type: "null" }],
    },
    types: {
      oneOf: [
        {
          type: "array",
          items: { type: "string", enum: transactionTypeFilterValues },
          minItems: 1,
        },
        { type: "string", enum: transactionTypeFilterValues },
      ],
    },
    type: { type: "string", enum: transactionTypeFilterValues },
    status: { type: "string", enum: transactionStatuses },
  },
};

const jobParams = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
};

function serializeDailyIncomePdfJob(job) {
  const downloadPath =
    job?.status === "completed" && job?.filePath
      ? buildDailyIncomePdfJobDownloadPath(job._id)
      : null;

  return {
    success: true,
    jobId: String(job._id),
    reportType: job.reportType || "daily_income_pdf",
    status: job.status,
    totalRecords: job.totalRecords || 0,
    fileName: job.fileName || null,
    downloadPath,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
  };
}

async function createDailyIncomeHandler(req, reply) {
  const payload = {
    ...(req.body || {}),
    ...buildDailyIncomePayload(req.body || {}),
  };

  try {
    const rpc = await getDailyIncomeReportRPC(payload);
    return reply.send({ ok: true, data: rpc });
  } catch (err) {
    req.log.error({ err }, "daily-income-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch daily income report",
      error: err?.message || String(err),
    });
  }
}

async function createDailyIncomePdfHandler(req, reply) {
  const payload = {
    ...(req.body || {}),
    ...buildDailyIncomePayload(req.body || {}),
  };

  try {
    const { pdf } = await generateDailyIncomePdfBuffer(payload);
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename=\"daily-income-report-${ts}.pdf\"`
    );
    return reply.send(pdf);
  } catch (err) {
    req.log.error({ err }, "daily-income-report-pdf failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to generate daily income report pdf",
      error: err?.message || String(err),
    });
  }
}

async function createCancelledTransactionsHandler(req, reply) {
  const payload = {
    ...(req.body || {}),
    ...buildDailyIncomePayload({
      ...(req.body || {}),
      status: "cancelled",
      report_title:
        req.body?.report_title || "Cancelled Transactions Report",
    }),
  };

  try {
    const rpc = await getDailyIncomeReportRPC(payload);
    return reply.send({ ok: true, data: rpc });
  } catch (err) {
    req.log.error({ err }, "cancelled-transactions-report failed");
    return reply.code(500).send({
      ok: false,
      message: "Failed to fetch cancelled transactions report",
      error: err?.message || String(err),
    });
  }
}

async function createDailyIncomePdfJobHandler(req, reply) {
  try {
    const payload = {
      ...(req.body || {}),
      ...buildDailyIncomePayload(req.body || {}),
    };
    const job = await DailyIncomePdfJob.create({
      status: "queued",
      payload,
      createdBy: req.user?.id || req.user?._id || null,
    });

    enqueueDailyIncomePdfJob(job._id, req.log);

    return reply.code(202).send({
      success: true,
      message: "Daily income PDF job accepted",
      jobId: String(job._id),
      status: job.status,
      downloadPath: buildDailyIncomePdfJobDownloadPath(job._id),
    });
  } catch (err) {
    req.log.error({ err }, "createDailyIncomePdfJobHandler failed");
    return reply.code(500).send({
      success: false,
      message: "Failed to create daily income pdf job",
      error: err?.message || String(err),
    });
  }
}

async function getDailyIncomePdfJobStatusHandler(req, reply) {
  try {
    const { id } = req.params || {};
    const job = await DailyIncomePdfJob.findById(id).lean();

    if (!job) {
      return reply.code(404).send({
        success: false,
        message: "Job not found",
      });
    }

    return reply.send(serializeDailyIncomePdfJob(job));
  } catch (err) {
    req.log.error({ err }, "getDailyIncomePdfJobStatusHandler failed");
    return reply.code(500).send({
      success: false,
      message: "Failed to fetch daily income pdf job status",
      error: err?.message || String(err),
    });
  }
}

async function downloadDailyIncomePdfJobHandler(req, reply) {
  try {
    const { id } = req.params || {};
    const job = await DailyIncomePdfJob.findById(id).lean();

    if (!job) {
      return reply.code(404).send({
        success: false,
        message: "Job not found",
      });
    }

    if (job.status !== "completed" || !job.filePath) {
      return reply.code(409).send({
        success: false,
        message: "Job is not ready for download",
      });
    }

    let stat = null;
    try {
      stat = await fs.promises.stat(job.filePath);
    } catch {
      return reply.code(404).send({
        success: false,
        message: "Generated PDF file not found",
      });
    }

    reply.header("Content-Type", job.contentType || "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename=\"${job.fileName || "daily-income-report.pdf"}\"`
    );
    if (stat?.size) reply.header("Content-Length", stat.size);
    return reply.send(fs.createReadStream(job.filePath));
  } catch (err) {
    req.log.error({ err }, "downloadDailyIncomePdfJobHandler failed");
    return reply.code(500).send({
      success: false,
      message: "Failed to download daily income pdf job file",
      error: err?.message || String(err),
    });
  }
}

async function routes(fastify, opts) {
  const { authRoute } = opts;

  fastify.post(
    "/daily-income-report",
    {
      ...authRoute(
        {
          tags: ["Income Report"],
          body: dailyIncomeBody,
        },
        "Income Report"
      ),
    },
    createDailyIncomeHandler
  );

  fastify.post(
    "/daily-income-report-pdf",
    {
      ...authRoute(
        {
          tags: ["Income Report"],
          body: dailyIncomeBody,
        },
        "Income Report"
      ),
    },
    createDailyIncomePdfHandler
  );

  fastify.post(
    "/cancelled-transactions-report",
    {
      ...authRoute(
        {
          tags: ["Cancelled Transactions Report"],
          body: dailyIncomeBody,
        },
        "Cancelled Transactions Report"
      ),
    },
    createCancelledTransactionsHandler
  );

  fastify.post(
    "/daily-income-report-pdf/jobs",
    {
      ...authRoute(
        {
          tags: ["Income Report"],
          body: dailyIncomeBody,
        },
        "Income Report"
      ),
    },
    createDailyIncomePdfJobHandler
  );

  fastify.get(
    "/daily-income-report-pdf/jobs/:id",
    {
      ...authRoute(
        {
          tags: ["Income Report"],
          params: jobParams,
        },
        "Income Report"
      ),
    },
    getDailyIncomePdfJobStatusHandler
  );

  fastify.get(
    "/daily-income-report-pdf/jobs/:id/download",
    {
      ...authRoute(
        {
          tags: ["Income Report"],
          params: jobParams,
        },
        "Income Report"
      ),
    },
    downloadDailyIncomePdfJobHandler
  );
}

export default fp(routes);
