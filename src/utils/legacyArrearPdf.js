import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

function formatMoney(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function drawRow(doc, columns, row, y, { header = false } = {}) {
  let cursorX = doc.page.margins.left;
  const rowHeight = 20;

  if (header) {
    doc
      .rect(
        doc.page.margins.left,
        y - 4,
        doc.page.width - doc.page.margins.left - doc.page.margins.right,
        rowHeight
      )
      .fill("#e5e7eb");
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9);
  } else {
    doc.fillColor("#111827").font("Helvetica").fontSize(9);
  }

  for (const col of columns) {
    const text = String(row[col.key] ?? "");
    doc.text(text, cursorX + 4, y, {
      width: col.width - 8,
      align: col.align || "left",
      lineBreak: false,
      ellipsis: true,
    });
    doc
      .moveTo(cursorX, y - 4)
      .lineTo(cursorX, y - 4 + rowHeight)
      .strokeColor("#d1d5db")
      .stroke();
    cursorX += col.width;
  }

  doc
    .moveTo(cursorX, y - 4)
    .lineTo(cursorX, y - 4 + rowHeight)
    .strokeColor("#d1d5db")
    .stroke();

  doc
    .moveTo(doc.page.margins.left, y - 4 + rowHeight)
    .lineTo(
      doc.page.width - doc.page.margins.right,
      y - 4 + rowHeight
    )
    .strokeColor("#d1d5db")
    .stroke();

  return y + rowHeight;
}

function fitColumnsToPage(doc, columns) {
  const availableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const currentWidth = columns.reduce((sum, col) => sum + Number(col.width || 0), 0);
  if (currentWidth <= availableWidth) return columns;

  const scale = availableWidth / currentWidth;
  return columns.map((col) => ({
    ...col,
    width: Math.max(28, Math.floor(col.width * scale)),
  }));
}

const ASSETS_DIR = path.resolve(process.cwd(), "assets");
const asset = (name) => path.join(ASSETS_DIR, name);

function drawImageSafe(doc, imgPath, x, y, width, height) {
  try {
    if (!imgPath || !fs.existsSync(imgPath)) return;
    doc.image(imgPath, x, y, { width, height });
  } catch {}
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
  const dd = get("day");
  const mm = get("month");
  const yyyy = get("year");
  const hh = get("hour");
  const min = get("minute");
  const ss = get("second");
  return `${dd}-${mm}-${yyyy}, ${hh}:${min}:${ss}`;
}

function computeTotalArrear(item = {}) {
  return (
    Number(item.water_arrear || 0) +
    Number(item.sewer_arrear || 0) +
    Number(item.meter_rent_arrear || 0) +
    Number(item.other_arrear || 0) +
    Number(item.late_fine || 0)
  );
}

export async function createLegacyArrearSummaryPdf({
  rows = [],
  totals = {},
  department,
  grouping = {},
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
  const ujsLogoPath = asset("logo2.png");
  const ujnLogoPath = asset("logo3.jpg");
  const generatedAtText = formatGeneratedAt(new Date());
  const deptToken = String(department || "").trim().toUpperCase();
  const isUJN = deptToken === "N" || deptToken === "UJN";
  const isUJS = deptToken === "J" || deptToken === "UJS";
  const headerLogoPath = isUJN ? ujnLogoPath : isUJS ? ujsLogoPath : null;

  function drawPageHeader() {
    if (fs.existsSync(watermarkPath)) {
      doc.save();
      doc.opacity(0.06);
      const wmWidth = doc.page.width * 0.55;
      const wmX = (doc.page.width - wmWidth) / 2;
      const wmY = doc.page.margins.top + 20;
      drawImageSafe(doc, watermarkPath, wmX, wmY, wmWidth);
      doc.opacity(1).restore();
    }

    const logoSize = 30;
    const headerTop = doc.page.margins.top - 4;
    const logoX = doc.page.margins.left;
    drawImageSafe(doc, headerLogoPath, logoX, headerTop, logoSize, logoSize);

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor("#111827")
      .text("Legacy Arrear Summary Report", doc.page.margins.left, headerTop + 2, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#111827")
      .text(
        `Generated At: ${generatedAtText}`,
        doc.page.margins.left,
        headerTop + 24,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "center",
        }
      );
  }

  drawPageHeader();

  const columns = [
    { key: "index", width: 36, align: "right" },
    { key: "division", width: 180 },
  ];
  if (grouping.by_collection_center) {
    columns.push({ key: "collection_center", width: 170 });
  }
  if (grouping.by_scheme) {
    columns.push({ key: "scheme", width: 170 });
  }
  columns.push(
    { key: "water_arrear", width: 95, align: "right" },
    { key: "sewer_arrear", width: 95, align: "right" },
    { key: "meter_rent_arrear", width: 110, align: "right" },
    { key: "other_arrear", width: 95, align: "right" },
    { key: "late_fine", width: 90, align: "right" },
    { key: "total", width: 95, align: "right" },
    { key: "advance", width: 90, align: "right" }
  );
  const fittedColumns = fitColumnsToPage(doc, columns);

  let y = doc.page.margins.top + 46;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 24;

  const headerRow = {
    index: "S.No",
    division: "Division",
    collection_center: "Collection Center",
    scheme: "Scheme",
    water_arrear: "Water Arrear",
    sewer_arrear: "Sewer Arrear",
    meter_rent_arrear: "Meter Rent Arrear",
    other_arrear: "Other Arrear",
    late_fine: "Late Fine",
    total: "Total",
    advance: "Advance",
  };

  y = drawRow(doc, fittedColumns, headerRow, y, { header: true });

  rows.forEach((row, index) => {
    if (y > pageBottom()) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
      drawPageHeader();
      y = doc.page.margins.top + 46;
      y = drawRow(doc, fittedColumns, headerRow, y, { header: true });
    }

    y = drawRow(
      doc,
      fittedColumns,
      {
        index: index + 1,
        division: row.division || "-",
        collection_center: row.collection_center || "-",
        scheme: row.scheme || "-",
        water_arrear: formatMoney(row.water_arrear),
        sewer_arrear: formatMoney(row.sewer_arrear),
        meter_rent_arrear: formatMoney(row.meter_rent_arrear),
        other_arrear: formatMoney(row.other_arrear),
        late_fine: formatMoney(row.late_fine),
        total: formatMoney(computeTotalArrear(row)),
        advance: formatMoney(row.advance),
      },
      y
    );
  });

  if (y > pageBottom()) {
    doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
    drawPageHeader();
    y = doc.page.margins.top + 46;
    y = drawRow(doc, fittedColumns, headerRow, y, { header: true });
  }

  y = drawRow(
    doc,
    fittedColumns,
    {
      index: "",
      division: "TOTAL",
      collection_center: "",
      scheme: "",
      water_arrear: formatMoney(totals.water_arrear),
      sewer_arrear: formatMoney(totals.sewer_arrear),
      meter_rent_arrear: formatMoney(totals.meter_rent_arrear),
      other_arrear: formatMoney(totals.other_arrear),
      late_fine: formatMoney(totals.late_fine),
      total: formatMoney(computeTotalArrear(totals)),
      advance: formatMoney(totals.advance),
    },
    y,
    { header: true }
  );

  doc.end();
  return done;
}
