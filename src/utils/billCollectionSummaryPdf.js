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

function fitColumnsToPage(doc, columns) {
  const availableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const currentWidth = columns.reduce((sum, col) => sum + Number(col.width || 0), 0);
  if (currentWidth <= availableWidth) return columns;
  const scale = availableWidth / currentWidth;
  return columns.map((col) => ({ ...col, width: Math.max(28, Math.floor(col.width * scale)) }));
}

function drawRow(doc, columns, row, y, { header = false, rowHeight = 20 } = {}) {
  let cursorX = doc.page.margins.left;
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

function normalizeMonths(value) {
  if (!Array.isArray(value)) return "-";
  const out = value.map((v) => String(v || "").trim()).filter(Boolean);
  return out.length ? out.join(", ") : "-";
}

export async function createBillCollectionSummaryPdf({
  data = {},
  billCycle = 0,
  department,
} = {}) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
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
      drawImageSafe(doc, watermarkPath, (doc.page.width - wmWidth) / 2, doc.page.margins.top + 20, wmWidth);
      doc.opacity(1).restore();
    }

    const headerTop = doc.page.margins.top - 4;
    drawImageSafe(doc, headerLogoPath, doc.page.margins.left, headerTop, 30, 30);
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor("#111827")
      .text("Bill Collection Summary Report", doc.page.margins.left, headerTop + 2, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#111827")
      .text(`Generated At: ${generatedAtText}`, doc.page.margins.left, headerTop + 24, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
  }

  drawPageHeader();
  let y = doc.page.margins.top + 48;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 16;

  const summaryText = `Total Customers: ${Number(data.total_customers || 0)}    Total Billed Customers: ${Number(
    data.total_billed_customers || 0
  )}    Pending Bill Generation: ${Number(data.pending_bill_generation_count || 0)}    Bill Cycle: ${Number(
    billCycle || 0
  )}`;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(summaryText, doc.page.margins.left, y);
  y += 18;

  const sections = [
    {
      title: "Division Wise Details",
      key: "division_wise_details",
      nameKey: "division_name",
      idKey: "division_id",
      label: "Division",
      showId: true,
    },
    {
      title: "Collection Center Wise Details",
      key: "collection_center_wise_details",
      nameKey: "collection_center_name",
      idKey: "collection_center_id",
      label: "Collection Center",
      showId: false,
    },
    {
      title: "Scheme Wise Details",
      key: "scheme_wise_details",
      nameKey: "scheme_name",
      idKey: "scheme_id",
      label: "Scheme",
      showId: false,
    },
  ];

  for (const section of sections) {
    const rows = Array.isArray(data?.[section.key]) ? data[section.key] : [];
    if (!rows.length) continue;

    if (y > pageBottom() - 50) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
      drawPageHeader();
      y = doc.page.margins.top + 48;
    }

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(section.title, doc.page.margins.left, y);
    y += 14;

    const columns = fitColumnsToPage(doc, [
      { key: "index", width: 36, align: "right" },
      { key: "name", width: 220 },
      // ...(section.showId ? [{ key: "id", width: 140 }] : []),
      { key: "total_customers", width: 90, align: "right" },
      { key: "total_billed_customers", width: 110, align: "right" },
      { key: "pending_bill_generation_count", width: 130, align: "right" },
      { key: "bill_months", width: 250 },
    ]);

    y = drawRow(
      doc,
      columns,
        {
          index: "S.No",
          name: section.label,
          ...(section.showId ? { id: "ID" } : {}),
          total_customers: "Customers",
          total_billed_customers: "Billed",
          pending_bill_generation_count: "Pending",
        bill_months: "Bill Months",
      },
      y,
      { header: true }
    );

    rows.forEach((row, idx) => {
      if (y > pageBottom()) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
        drawPageHeader();
        y = doc.page.margins.top + 48;
        y = drawRow(
          doc,
          columns,
          {
            index: "S.No",
            name: section.label,
            ...(section.showId ? { id: "ID" } : {}),
            total_customers: "Customers",
            total_billed_customers: "Billed",
            pending_bill_generation_count: "Pending",
            bill_months: "Bill Months",
          },
          y,
          { header: true }
        );
      }

      y = drawRow(doc, columns, {
        index: idx + 1,
        name: row?.[section.nameKey] || "-",
        ...(section.showId ? { id: row?.[section.idKey] || "-" } : {}),
        total_customers: Number(row?.total_customers || 0),
        total_billed_customers: Number(row?.total_billed_customers || 0),
        pending_bill_generation_count: Number(row?.pending_bill_generation_count || 0),
        bill_months: normalizeMonths(row?.bill_months),
      }, y);
    });

    y += 10;
  }

  doc.end();
  return done;
}
