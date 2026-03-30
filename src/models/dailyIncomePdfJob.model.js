import mongoose from "mongoose";

const DailyIncomePdfJobSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: ["daily_income_pdf"],
      default: "daily_income_pdf",
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued",
      index: true,
    },
    payload: {
      type: Object,
      required: true,
    },
    createdBy: {
      type: String,
      default: null,
      index: true,
    },
    totalRecords: {
      type: Number,
      default: 0,
    },
    fileName: {
      type: String,
      default: null,
    },
    filePath: {
      type: String,
      default: null,
    },
    contentType: {
      type: String,
      default: "application/pdf",
    },
    error: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

DailyIncomePdfJobSchema.index({ createdAt: -1 });

const DailyIncomePdfJob =
  mongoose.models.DailyIncomePdfJob ||
  mongoose.model("DailyIncomePdfJob", DailyIncomePdfJobSchema);

export default DailyIncomePdfJob;
