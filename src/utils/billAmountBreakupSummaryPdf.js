import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const ASSETS_DIR = path.resolve(process.cwd(), "assets");
const asset = (name) => path.join(ASSETS_DIR, name);

function drawImageSafe(doc, imgPath, x, y, width, height) {
  try {
    if (!imgPath || !fs.existsSync(imgPath)) return;
    doc.image(imgPath, x, y, { width, height });
  } catch {}
}

function cleanString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function toNum(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatGeneratedAt(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("day")}-${get("month")}-${get("year")}, ${get("hour")}:${get("minute")}:${get("second")}`;
}

function formatCount(value) {
  return `${Math.round(toNum(value))}`;
}

function formatCurrency(value) {
  return `Rs. ${toNum(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateRange(filters = {}, body = {}) {
  const start = firstNonEmpty(
    filters?.start_date,
    body?.start_date,
    body?.startDate,
    body?.from_date,
    body?.from
  );
  const end = firstNonEmpty(
    filters?.end_date,
    body?.end_date,
    body?.endDate,
    body?.to_date,
    body?.to
  );
  if (start && end) return `${start} to ${end}`;
  return start || end || "All";
}

function resolveHeaderLogoPath(department) {
  const deptToken = cleanString(department).toUpperCase();
  if (deptToken === "N" || deptToken === "UJN") return asset("logo3.jpg");
  if (deptToken === "J" || deptToken === "UJS") return asset("logo2.png");
  return null;
}

function buildPages(data = {}) {
  const pages = [];
  const pushRows = (rows = [], type = "") => {
    for (const row of rows) pages.push({ type, row });
  };

  pushRows(data?.division_wise_details, "division");
  pushRows(data?.collection_center_wise_details, "collection_center");
  pushRows(data?.scheme_wise_details, "scheme");

  if (!pages.length) {
    pages.push({ type: "summary", row: data?.totals || {} });
  }

  return pages;
}

function pageTitle(type = "") {
  if (type === "division") return "Division";
  if (type === "collection_center") return "Collection Center";
  if (type === "scheme") return "Scheme";
  return "Overall Summary";
}

function resolvePrimaryName(page = {}) {
  if (page?.type === "division") {
    return firstNonEmpty(page?.row?.division_name, page?.row?.division_id, "Overall Summary");
  }
  if (page?.type === "collection_center") {
    return firstNonEmpty(
      page?.row?.collection_center_name,
      page?.row?.collection_center_id,
      "Collection Center Summary"
    );
  }
  if (page?.type === "scheme") {
    return firstNonEmpty(page?.row?.scheme_name, page?.row?.scheme_id, "Scheme Summary");
  }
  return "Overall Summary";
}

function buildContextEntries(page = {}, filters = {}, body = {}) {
  const divisionValue =
    page?.type === "division"
      ? firstNonEmpty(page?.row?.division_name, page?.row?.division_id)
      : firstNonEmpty(body?.division, body?.division_id, body?.divisionId, filters?.division_id, "All");
  const collectionCenterValue =
    page?.type === "collection_center"
      ? firstNonEmpty(
          page?.row?.collection_center_name,
          page?.row?.collection_center_id
        )
      : firstNonEmpty(
          body?.collection_center,
          body?.collectionCenter,
          body?.collection_center_id,
          body?.collectionCenterId,
          filters?.collection_center_id,
          "All"
        );
  const schemeValue =
    page?.type === "scheme"
      ? firstNonEmpty(page?.row?.scheme_name, page?.row?.scheme_id)
      : firstNonEmpty(body?.scheme, body?.scheme_id, body?.schemeId, filters?.scheme_id, "All");

  return [
    { label: "Division", value: divisionValue || "All" },
    { label: "Collection Center", value: collectionCenterValue || "All" },
    { label: "Scheme", value: schemeValue || "All" },
    { label: "Period", value: formatDateRange(filters, body) },
  ];
}

function cardPalette() {
  return {
    summary: [
      { fill: "#DBEAFE", value: "#1D4ED8" },
      { fill: "#EDE9FE", value: "#7C3AED" },
      { fill: "#DBEAFE", value: "#2563EB" },
      { fill: "#DCFCE7", value: "#047857" },
      { fill: "#DFF6FB", value: "#0369A1" },
      { fill: "#E0F2FE", value: "#0F766E" },
    ],
    charges: [
      { fill: "#E0E7FF", value: "#3730A3" },
      { fill: "#F3F4F6", value: "#111827" },
      { fill: "#DBF5F0", value: "#0F766E" },
      { fill: "#FCE7F3", value: "#BE123C" },
      { fill: "#FDF2F8", value: "#BE185D" },
      { fill: "#F3E8FF", value: "#A21CAF" },
    ],
    arrears: [
      { fill: "#FEF3C7", value: "#B45309" },
      { fill: "#ECFCCB", value: "#3F6212" },
      { fill: "#DBEAFE", value: "#0369A1" },
      { fill: "#FEF3C7", value: "#C2410C" },
      { fill: "#FFEDD5", value: "#C2410C" },
    ],
    advance: [{ fill: "#DCFCE7", value: "#047857" }],
  };
}

function drawHeader(
  doc,
  {
    primaryLabel,
    primaryValue,
    generatedAtText,
    headerLogoPath,
    watermarkPath,
    pageNumber,
    totalPages,
    contextEntries,
  }
) {
  if (fs.existsSync(watermarkPath)) {
    doc.save();
    doc.opacity(0.055);
    const wmWidth = doc.page.width * 0.52;
    drawImageSafe(doc, watermarkPath, (doc.page.width - wmWidth) / 2, 70, wmWidth);
    doc.opacity(1).restore();
  }

  const headerTop = doc.page.margins.top - 4;
  drawImageSafe(doc, headerLogoPath, doc.page.margins.left, headerTop, 32, 32);

  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor("#111827")
    .text("Bill Amount Breakup Summary Report", doc.page.margins.left, headerTop + 2, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "center",
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#4B5563")
    .text(`Generated At: ${generatedAtText}`, doc.page.margins.left, headerTop + 24, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 120,
      align: "center",
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#6B7280")
    .text(`Page ${pageNumber} / ${totalPages}`, doc.page.width - doc.page.margins.right - 90, headerTop + 24, {
      width: 90,
      align: "right",
    });

  const pillY = doc.page.margins.top + 40;
  const pillWidth = 240;
  doc.roundedRect(doc.page.margins.left, pillY, pillWidth, 28, 12).fill("#E0F2FE");
  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(`${primaryLabel}: ${primaryValue}`, doc.page.margins.left + 12, pillY + 8, {
      width: pillWidth - 24,
      align: "left",
      lineBreak: false,
      ellipsis: true,
    });

  const availableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 10;
  const chipY = pillY + 42;
  const chipWidth = (availableWidth - gap * 3) / 4;

  contextEntries.forEach((entry, index) => {
    const x = doc.page.margins.left + index * (chipWidth + gap);
    doc.roundedRect(x, chipY, chipWidth, 40, 10).fill("#F8FAFC");
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#64748B")
      .text(entry.label, x + 10, chipY + 8, {
        width: chipWidth - 20,
        lineBreak: false,
        ellipsis: true,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor("#111827")
      .text(entry.value, x + 10, chipY + 20, {
        width: chipWidth - 20,
        lineBreak: false,
        ellipsis: true,
      });
  });

  return chipY + 54;
}

function drawSectionTitle(doc, title, y) {
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#334155")
    .text(title, doc.page.margins.left, y);
  doc
    .moveTo(doc.page.margins.left, y + 16)
    .lineTo(doc.page.margins.left + 120, y + 16)
    .strokeColor("#CBD5E1")
    .lineWidth(1)
    .stroke();
  return y + 24;
}

function drawCardGrid(doc, y, items = [], { columns = 6, palette = [] } = {}) {
  if (!items.length) return y;

  const availableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 10;
  const cardWidth = (availableWidth - gap * (columns - 1)) / columns;
  const cardHeight = 58;

  items.forEach((item, index) => {
    const rowIndex = Math.floor(index / columns);
    const colIndex = index % columns;
    const x = doc.page.margins.left + colIndex * (cardWidth + gap);
    const cardY = y + rowIndex * (cardHeight + gap);
    const style = palette[index % palette.length] || {
      fill: "#EFF6FF",
      value: "#1D4ED8",
    };

    doc.roundedRect(x, cardY, cardWidth, cardHeight, 10).fill(style.fill);
    doc
      .font("Helvetica")
      .fontSize(8.7)
      .fillColor("#475569")
      .text(item.label, x + 10, cardY + 10, {
        width: cardWidth - 20,
        height: 20,
        ellipsis: true,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(style.value)
      .text(item.value, x + 10, cardY + 30, {
        width: cardWidth - 20,
        lineBreak: false,
        ellipsis: true,
      });
  });

  const totalRows = Math.ceil(items.length / columns);
  return y + totalRows * cardHeight + Math.max(totalRows - 1, 0) * gap + 12;
}

function buildSections(row = {}) {
  const totalBillGeneratedCount = toNum(row?.total_bill_generated_count);
  const totalBillPaidCount = toNum(row?.total_bill_paid_count);
  const totalPendingCount = Math.max(totalBillGeneratedCount - totalBillPaidCount, 0);
  const totalAmount = toNum(row?.total_amount);
  const totalCollectedAmount = toNum(row?.total_collected_amount);
  const totalPendingAmount = Math.max(totalAmount - totalCollectedAmount, 0);

  return [
    {
      title: "Bill Amount Details",
      columns: 6,
      palette: cardPalette().summary,
      items: [
        { label: "Total Bills Generated", value: formatCount(totalBillGeneratedCount) },
        { label: "Total Bill Paid", value: formatCount(totalBillPaidCount) },
        { label: "Total Bill Pending", value: formatCount(totalPendingCount) },
        { label: "Total Bill Amount", value: formatCurrency(totalAmount) },
        { label: "Total Collected Amount", value: formatCurrency(totalCollectedAmount) },
        { label: "Total Pending Amount", value: formatCurrency(totalPendingAmount) },
      ],
    },
    {
      title: "Water Charges Details",
      columns: 6,
      palette: cardPalette().charges,
      items: [
        { label: "Water Charges", value: formatCurrency(row?.total_water_charges) },
        { label: "Sewer Charges", value: formatCurrency(row?.total_sewer_charges) },
        { label: "Meter Rent", value: formatCurrency(row?.total_meter_rent) },
        { label: "Late Fine", value: formatCurrency(row?.total_late_fine) },
        { label: "Other Charges", value: formatCurrency(row?.total_other_charges) },
        { label: "Total Discount", value: formatCurrency(row?.total_discount) },
      ],
    },
    {
      title: "Old Bill Arrear Details",
      columns: 5,
      palette: cardPalette().arrears,
      items: [
        { label: "Water Arrear", value: formatCurrency(row?.total_water_arrear) },
        { label: "Sewer Arrear", value: formatCurrency(row?.total_sewer_arrear) },
        { label: "Meter Rent Arrear", value: formatCurrency(row?.total_meter_rent_arrear) },
        { label: "Other Arrear", value: formatCurrency(row?.total_other_arrear) },
        { label: "Total Arrear", value: formatCurrency(row?.total_arrear) },
      ],
    },
    {
      title: "Advance",
      columns: 6,
      palette: cardPalette().advance,
      items: [{ label: "Advance", value: formatCurrency(row?.total_advance) }],
    },
  ];
}

export async function createBillAmountBreakupSummaryPdf({
  body = {},
  data = {},
  department,
} = {}) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pages = buildPages(data);
  const generatedAtText = formatGeneratedAt(new Date());
  const headerLogoPath = resolveHeaderLogoPath(department);
  const watermarkPath = asset("watermark.png");
  const filters = data?.filters || {};

  pages.forEach((page, index) => {
    if (index > 0) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 28 });
    }

    let y = drawHeader(doc, {
      primaryLabel: pageTitle(page?.type),
      primaryValue: resolvePrimaryName(page),
      generatedAtText,
      headerLogoPath,
      watermarkPath,
      pageNumber: index + 1,
      totalPages: pages.length,
      contextEntries: buildContextEntries(page, filters, body),
    });

    for (const section of buildSections(page?.row || data?.totals || {})) {
      y = drawSectionTitle(doc, section.title, y);
      y = drawCardGrid(doc, y, section.items, {
        columns: section.columns,
        palette: section.palette,
      });
    }
  });

  doc.end();
  return done;
}
