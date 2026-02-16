import PDFDocument from "pdfkit";

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

export async function createLegacyArrearSummaryPdf({
  rows = [],
  totals = {},
  filters = {},
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

  doc.font("Helvetica-Bold").fontSize(14).text("Legacy Arrear Summary Report", {
    align: "left",
  });
  doc.moveDown(0.3);
  doc
    .font("Helvetica")
    .fontSize(10)
    .text(`Generated At: ${new Date().toLocaleString("en-IN", { hour12: false })}`);
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(
      `Filters: department=${filters.department_id || "-"}, division=${filters.division || filters.division_id || "-"}, collection_center=${filters.collection_center || filters.collection_center_id || "-"}, scheme=${filters.scheme || filters.scheme_id || "-"}`
    );
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(
      `Grouping: division + collection_center=${grouping.by_collection_center ? "yes" : "no"} + scheme=${grouping.by_scheme ? "yes" : "no"}`
    );

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
    { key: "total_arrear", width: 100, align: "right" }
  );

  let y = doc.y + 10;
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
    total_arrear: "Total Arrear",
  };

  y = drawRow(doc, columns, headerRow, y, { header: true });

  rows.forEach((row, index) => {
    if (y > pageBottom()) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
      y = doc.page.margins.top;
      y = drawRow(doc, columns, headerRow, y, { header: true });
    }

    y = drawRow(
      doc,
      columns,
      {
        index: index + 1,
        division: row.division || "-",
        collection_center: row.collection_center || "-",
        scheme: row.scheme || "-",
        water_arrear: formatMoney(row.water_arrear),
        sewer_arrear: formatMoney(row.sewer_arrear),
        meter_rent_arrear: formatMoney(row.meter_rent_arrear),
        other_arrear: formatMoney(row.other_arrear),
        total_arrear: formatMoney(row.total_arrear),
      },
      y
    );
  });

  if (y > pageBottom()) {
    doc.addPage({ size: "A4", layout: "landscape", margin: 24 });
    y = doc.page.margins.top;
    y = drawRow(doc, columns, headerRow, y, { header: true });
  }

  y = drawRow(
    doc,
    columns,
    {
      index: "",
      division: "TOTAL",
      collection_center: "",
      scheme: "",
      water_arrear: formatMoney(totals.water_arrear),
      sewer_arrear: formatMoney(totals.sewer_arrear),
      meter_rent_arrear: formatMoney(totals.meter_rent_arrear),
      other_arrear: formatMoney(totals.other_arrear),
      total_arrear: formatMoney(totals.total_arrear),
    },
    y,
    { header: true }
  );

  doc.end();
  return done;
}

