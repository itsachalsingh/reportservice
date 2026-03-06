import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const ASSETS_DIR = path.resolve(process.cwd(), "assets");
const asset = (name) => path.join(ASSETS_DIR, name);
const fontAsset = (name) => path.join(ASSETS_DIR, "fonts", name);

function registerFonts(doc) {
  const regular = fontAsset("NotoSansDevanagari-Regular.ttf");
  const bold = fontAsset("NotoSansDevanagari-Bold.ttf");
  if (fs.existsSync(regular)) doc.registerFont("Hindi-Regular", regular);
  if (fs.existsSync(bold)) doc.registerFont("Hindi-Bold", bold);
}

function fontName(kind = "regular") {
  const regular = fontAsset("NotoSansDevanagari-Regular.ttf");
  const bold = fontAsset("NotoSansDevanagari-Bold.ttf");
  if (kind === "bold") {
    return fs.existsSync(bold) ? "Hindi-Bold" : "Helvetica-Bold";
  }
  return fs.existsSync(regular) ? "Hindi-Regular" : "Helvetica";
}

function money(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toDisplayDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function drawImageSafe(doc, imgPath, x, y, width, height) {
  try {
    if (!imgPath || !fs.existsSync(imgPath)) return;
    doc.image(imgPath, x, y, { width, height });
  } catch {}
}

function sanitizeCellText(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function estimateRowHeight(doc, columns, row, { header = false } = {}) {
  const minHeight = header ? 20 : 22;
  if (header) return minHeight;

  let height = minHeight;
  for (const col of columns) {
    if (!col.wrap) continue;
    const text = sanitizeCellText(row?.[col.key] ?? "");
    const measured = doc.heightOfString(text, {
      width: Math.max(10, col.width - 6),
      align: col.align || "left",
      lineGap: 0,
    });
    height = Math.max(height, Math.min(46, Math.ceil(measured) + 6));
  }
  return height;
}

function drawRow(doc, columns, row, y, { header = false } = {}) {
  let cursorX = doc.page.margins.left;
  const rowHeight = estimateRowHeight(doc, columns, row, { header });

  if (header) {
    doc
      .rect(
        doc.page.margins.left,
        y - 4,
        doc.page.width - doc.page.margins.left - doc.page.margins.right,
        rowHeight
      )
      .fill("#e5e7eb");
    doc.fillColor("#111827").font(fontName("bold")).fontSize(8);
  } else {
    doc.fillColor("#111827").font(fontName("regular")).fontSize(8);
  }

  for (const col of columns) {
    const text = sanitizeCellText(row[col.key] ?? "");
    doc.text(text, cursorX + 3, y, {
      width: col.width - 6,
      align: col.align || "left",
      lineBreak: Boolean(!header && col.wrap),
      height: rowHeight - 6,
      ellipsis: true,
    });
    doc.moveTo(cursorX, y - 4).lineTo(cursorX, y - 4 + rowHeight).strokeColor("#d1d5db").stroke();
    cursorX += col.width;
  }

  doc.moveTo(cursorX, y - 4).lineTo(cursorX, y - 4 + rowHeight).strokeColor("#d1d5db").stroke();
  doc
    .moveTo(doc.page.margins.left, y - 4 + rowHeight)
    .lineTo(doc.page.width - doc.page.margins.right, y - 4 + rowHeight)
    .strokeColor("#d1d5db")
    .stroke();

  return y + rowHeight;
}

function fitColumnsToPage(doc, columns) {
  const available = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const current = columns.reduce((sum, col) => sum + col.width, 0);
  if (current <= available) return columns;
  const scale = available / current;
  return columns.map((col) => ({
    ...col,
    width: Math.max(30, Math.floor(col.width * scale)),
  }));
}

export async function createDailyIncomePdf({
  payload = {},
  summary = {},
  details = [],
  pagination = {},
} = {}) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 24,
  });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const watermarkPath = asset("watermark.png");
  const logoPath = asset("header-logo.png");
  const generatedAt = toDisplayDate(new Date());
  registerFonts(doc);

  function drawHeader() {
    if (fs.existsSync(watermarkPath)) {
      doc.save();
      doc.opacity(0.06);
      const wmWidth = doc.page.width * 0.55;
      const wmX = (doc.page.width - wmWidth) / 2;
      const wmY = doc.page.margins.top + 20;
      drawImageSafe(doc, watermarkPath, wmX, wmY, wmWidth);
      doc.opacity(1).restore();
    }

    drawImageSafe(doc, logoPath, doc.page.margins.left, doc.page.margins.top - 4, 30, 30);

    doc
      .font(fontName("bold"))
      .fontSize(16)
      .fillColor("#111827")
      .text("Daily Collection Report", doc.page.margins.left, doc.page.margins.top - 2, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });

    const fromDate = payload?.start_date || "-";
    const toDate = payload?.end_date || "-";
    const type = payload?.type || payload?.types || "all";
    doc
      .font(fontName("regular"))
      .fontSize(9)
      .fillColor("#111827")
      .text(
        `From: ${fromDate}  To: ${toDate}  Type: ${type}  Generated At: ${generatedAt}`,
        doc.page.margins.left,
        doc.page.margins.top + 20,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "center",
        }
      );
  }

  drawHeader();

  let y = doc.page.margins.top + 44;
  doc.font(fontName("bold")).fontSize(9).fillColor("#111827");
  doc.text(`Total Payment: Rs ${money(summary?.total_collection)}`, doc.page.margins.left, y);
  doc.text(`Cash: Rs ${money(summary?.by_payment_method?.cash?.amount)}`, doc.page.margins.left + 170, y);
  doc.text(`Card: Rs ${money(summary?.by_payment_method?.card?.amount)}`, doc.page.margins.left + 300, y);
  doc.text(`Cheque: Rs ${money(summary?.by_payment_method?.cheque?.amount)}`, doc.page.margins.left + 430, y);
  doc.text(`DD: Rs ${money(summary?.by_payment_method?.["demand draft"]?.amount)}`, doc.page.margins.left + 570, y);
  doc.text(`Online: Rs ${money(summary?.by_payment_method?.online?.amount)}`, doc.page.margins.left + 700, y);

  y += 22;

  const rawColumns = [
    { key: "index", width: 35, align: "right" },
    { key: "consumer", width: 90, wrap: true },
    { key: "name", width: 90, wrap: true },
    { key: "receipt", width: 85, wrap: true },
    { key: "payment_method", width: 70 },
    { key: "payment_type", width: 65 },
    { key: "transaction_date", width: 120, wrap: true },
    { key: "water_charges", width: 80, align: "right" },
    { key: "sewer_charges", width: 80, align: "right" },
    { key: "meter_rent", width: 75, align: "right" },
    { key: "others", width: 65, align: "right" },
    { key: "late_fee", width: 65, align: "right" },
    { key: "discount", width: 65, align: "right" },
    { key: "paid_amount", width: 80, align: "right" },
    { key: "balance", width: 75, align: "right" },
  ];
  const columns = fitColumnsToPage(doc, rawColumns);

  const headerRow = {
    index: "S.No",
    consumer: "Consumer Code",
    name: "Name",
    receipt: "Receipt No",
    payment_method: "Method",
    payment_type: "Mode",
    transaction_date: "Date Paid",
    water_charges: "Water",
    sewer_charges: "Sewer",
    meter_rent: "Meter",
    others: "Other",
    late_fee: "Late Fee",
    discount: "Disc.",
    paid_amount: "Paid",
    balance: "Balance",
  };

  y = drawRow(doc, columns, headerRow, y, { header: true });
  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 24;

  for (const row of Array.isArray(details) ? details : []) {
    const rowData = {
      index: row?.index || "",
      consumer: row?.consumer_number || row?.application_number || row?.transaction_number || "-",
      name: row?.name || "-",
      receipt: row?.receipt_number || "-",
      payment_method: row?.payment_method || "-",
      payment_type: row?.payment_type || row?.type || "-",
      transaction_date: toDisplayDate(row?.transaction_date),
      water_charges: money(row?.water_charges),
      sewer_charges: money(row?.sewer_charges),
      meter_rent: money(row?.meter_rent),
      others: money(row?.others),
      late_fee: money(row?.late_fee),
      discount: money(row?.discount),
      paid_amount: money(row?.paid_amount ?? row?.amount),
      balance: money(row?.balance),
    };

    const nextHeight = estimateRowHeight(doc, columns, rowData, { header: false });
    if (y + nextHeight > pageBottom()) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
      drawHeader();
      y = doc.page.margins.top + 66;
      y = drawRow(doc, columns, headerRow, y, { header: true });
    }

    y = drawRow(doc, columns, rowData, y);
  }

  if (y > pageBottom()) {
    doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
    drawHeader();
    y = doc.page.margins.top + 66;
    y = drawRow(doc, columns, headerRow, y, { header: true });
  }

  y = drawRow(
    doc,
    columns,
    {
      index: "",
      consumer: "",
      name: "TOTAL",
      receipt: "",
      payment_method: "",
      payment_type: "",
      transaction_date: "",
      water_charges: "",
      sewer_charges: "",
      meter_rent: "",
      others: "",
      late_fee: "",
      discount: "",
      paid_amount: money(summary?.total_collection),
      balance: "",
    },
    y,
    { header: true }
  );

  doc
    .font(fontName("regular"))
    .fontSize(9)
    .fillColor("#111827")
    .text(
      `Page ${pagination?.page || 1} / ${pagination?.total_pages || 1} | Total Records: ${pagination?.total || details?.length || 0}`,
      doc.page.margins.left,
      y + 8,
      { align: "left" }
    );

  doc.end();
  return done;
}
