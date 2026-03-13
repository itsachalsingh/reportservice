import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const ASSETS_DIR = path.resolve(process.cwd(), "assets");
const asset = (name) => path.join(ASSETS_DIR, name);
const fontAsset = (name) => path.join(ASSETS_DIR, "fonts", name);

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

  return date
    .toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    })
    .replace(",", "");
}

function headerValue(value) {
  const v = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return v || "-";
}

function sanitizeCellText(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function nameWithFather(row = {}) {
  const consumerName = sanitizeCellText(
    row.name ?? row.consumer_name ?? row.customer_name ?? ""
  );
  const fatherName = sanitizeCellText(
    row.father_name ?? row.fatherName ?? row.f_name ?? ""
  );

  if (consumerName && fatherName) return `${consumerName} / ${fatherName}`;
  return consumerName || fatherName || "-";
}

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

function fitColumnsToPage(doc, rawColumns) {
  const available =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const total = rawColumns.reduce((sum, col) => sum + col.width, 0);
  if (total <= available) return rawColumns;

  const scale = available / total;
  const fitted = rawColumns.map((col) => {
    const minWidth = ["consumer", "name", "receipt"].includes(col.key) ? 70 : 42;
    return { ...col, width: Math.max(minWidth, Math.floor(col.width * scale)) };
  });

  let fittedTotal = fitted.reduce((sum, col) => sum + col.width, 0);
  let overflow = fittedTotal - available;
  while (overflow > 0) {
    const col = fitted.find((c) => c.width > 42 && !["consumer", "name", "receipt"].includes(c.key));
    if (!col) break;
    col.width -= 1;
    overflow -= 1;
  }

  fittedTotal = fitted.reduce((sum, col) => sum + col.width, 0);
  let extra = available - fittedTotal;
  const growthOrder = ["consumer", "name", "receipt", "date"];
  while (extra > 0) {
    for (const key of growthOrder) {
      if (extra <= 0) break;
      const col = fitted.find((c) => c.key === key);
      if (!col) continue;
      col.width += 1;
      extra -= 1;
    }
  }

  return fitted;
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

  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  const done = new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
  });

  const logoPath = asset("header-logo.png");
  const watermarkPath = asset("watermark.png");

  const generatedAt = toDisplayDate(new Date());
  registerFonts(doc);
  const firstDetail = Array.isArray(details) && details.length ? details[0] : {};
  const divisionName =
    summary?.filters?.division_name ||
    payload?.division_name ||
    summary?.filters?.division ||
    payload?.division ||
    firstDetail?.division ||
    "-";
  const collectionCenterName =
    summary?.filters?.collection_center_name ||
    payload?.collection_center_name ||
    summary?.filters?.collection_center ||
    payload?.collection_center ||
    firstDetail?.collection_center ||
    "-";

  function drawHeader() {
    if (fs.existsSync(watermarkPath)) {
      doc.save();
      doc.opacity(0.06);
      doc.image(
        watermarkPath,
        doc.page.width / 2 - 200,
        doc.page.height / 2 - 200,
        { width: 400 }
      );
      doc.restore();
    }

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, doc.page.margins.left, doc.page.margins.top - 4, {
        width: 30,
      });
    }

    doc
      .fontSize(16)
      .font(fontName("bold"))
      .text("Daily Collection Report", 0, doc.page.margins.top - 2, {
        align: "center",
      });

    doc
      .fontSize(8)
      .font(fontName("bold"))
      .text(
        `Division: ${headerValue(divisionName)}`,
        doc.page.margins.left,
        doc.page.margins.top - 2,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "right",
        }
      )
      .text(
        `Collection Center: ${headerValue(collectionCenterName)}`,
        doc.page.margins.left,
        doc.page.margins.top + 9,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "right",
        }
      );

    const fromDate = payload?.from_date
      ? toDisplayDate(payload.from_date).split(" ")[0]
      : payload?.start_date
      ? toDisplayDate(payload.start_date).split(" ")[0]
      : "-";

    doc
      .fontSize(9)
      .font(fontName("regular"))
      .text(
        `Date: ${fromDate}  Generated At: ${generatedAt}`,
        0,
        doc.page.margins.top + 18,
        { align: "center" }
      );
  }

  drawHeader();

  let y = doc.page.margins.top + 50;

  /* summary */

  const availableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalPaymentText = `Total Payment: Rs ${money(summary?.total_collection)}`;
  const paymentMethodItems = [
    `Online: Rs ${money(summary?.by_payment_method?.online?.amount)}`,
    `Card: Rs ${money(summary?.by_payment_method?.card?.amount)}`,
    `Cheque: Rs ${money(summary?.by_payment_method?.cheque?.amount)}`,
    `DD: Rs ${money(summary?.by_payment_method?.["demand draft"]?.amount)}`,
    `Cash: Rs ${money(summary?.by_payment_method?.cash?.amount)}`,
  ];

  doc
    .fontSize(10)
    .font(fontName("bold"))
    .text(totalPaymentText, doc.page.margins.left, y, {
      width: availableWidth,
      align: "left",
    });

  y += 14;

  const paymentMethodColWidth = availableWidth / paymentMethodItems.length;

  paymentMethodItems.forEach((text, i) => {
    doc
      .fontSize(9)
      .font(fontName("bold"))
      .text(text, doc.page.margins.left + paymentMethodColWidth * i, y, {
        width: paymentMethodColWidth,
      });
  });

  y += 24;

  /* column definition */

  const rawColumns = [
    { key: "index", label: "S.No", width: 40 },

    { key: "consumer", label: "Consumer", width: 170 },

    { key: "name", label: "Name / Father Name", width: 150 },

    { key: "receipt", label: "Receipt", width: 95 },

    { key: "date", label: "Date", width: 120 },

    { key: "water", label: "Water", width: 75 },

    { key: "sewer", label: "Sewer", width: 75 },

    { key: "meter", label: "Meter", width: 75 },

    { key: "other", label: "Other", width: 70 },

    { key: "late", label: "Late", width: 70 },

    { key: "disc", label: "Disc", width: 70 },

    { key: "arrears", label: "Arrears", width: 85 },

    
    { key: "total", label: "Total", width: 85 },

    { key: "paid", label: "Paid", width: 85 },

    { key: "advance", label: "Advance", width: 85 },

    { key: "balance", label: "Balance", width: 85 },
  ];
  const columns = fitColumnsToPage(doc, rawColumns);
  const wrapKeys = new Set(["consumer", "name", "receipt", "date"]);

  function estimateRowHeight(row, header = false) {
    if (header) return 22;
    let height = 24;
    doc.font(fontName("regular")).fontSize(8);
    columns.forEach((col) => {
      if (!wrapKeys.has(col.key)) return;
      const text = sanitizeCellText(row[col.key] ?? "");
      const measured = doc.heightOfString(text, {
        width: Math.max(10, col.width - 6),
        align: "left",
        lineGap: 0,
      });
      height = Math.max(height, Math.min(78, Math.ceil(measured) + 6));
    });
    return height;
  }

  function drawRow(row, header = false) {
    const rowHeight = estimateRowHeight(row, header);
    let x = doc.page.margins.left;

    if (header) {
      doc
        .rect(
          doc.page.margins.left,
          y - 3,
          doc.page.width - doc.page.margins.left - doc.page.margins.right,
          rowHeight
        )
        .fill("#e5e7eb");

      doc.fillColor("#111").font(fontName("bold")).fontSize(8);
    } else {
      doc.fillColor("#111").font(fontName("regular")).fontSize(8);
    }

    columns.forEach((col) => {
      const align = [
        "total",
        "paid",
        "water",
        "sewer",
        "meter",
        "other",
        "late",
        "disc",
        "arrears",
        "advance",
        "balance",
      ].includes(col.key)
        ? "right"
        : "left";

      const text = String(row[col.key] ?? "");
      const shouldWrap = header || wrapKeys.has(col.key);
      doc.text(text, x + 3, y, {
        width: col.width - 6,
        align,
        lineBreak: shouldWrap,
        height: rowHeight - 6,
        ellipsis: !shouldWrap,
      });

      doc.moveTo(x, y - 3).lineTo(x, y + rowHeight - 3).stroke("#ddd");

      x += col.width;
    });

    doc.moveTo(x, y - 3).lineTo(x, y + rowHeight - 3).stroke("#ddd");
    doc
      .moveTo(doc.page.margins.left, y + rowHeight - 3)
      .lineTo(doc.page.width - doc.page.margins.right, y + rowHeight - 3)
      .stroke("#ddd");

    y += rowHeight;
  }

  drawRow(
    Object.fromEntries(columns.map((c) => [c.key, c.label])),
    true
  );

  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 20;

  details.forEach((row, i) => {
    const rowData = {
      index: i + 1,

      consumer: `${
        row.consumer_number ||
        row.consumer_code ||
        "-"
      }\nMode - (${row.payment_method || "-"} / ${row.payment_type || "-"})\nAddress - ${
        row.address || row.consumer_address || "-"
      }`,

      name: nameWithFather(row),

      receipt: row.receipt_number || "-",

      date: toDisplayDate(row.transaction_date),

      total: money(row.bill_amount),

      paid: money(row.paid_amount ?? row.amount),

      water: money(row.water_charges),

      sewer: money(row.sewer_charges),

      meter: money(row.meter_rent),

      other: money(row.others),

      late: money(row.late_fee),

      disc: money(row.discount),

      arrears: money(row.arrears),

      advance: money(row.excess_amount),

      balance: money(row.balance),
    };

    const nextHeight = estimateRowHeight(rowData, false);
    if (y + nextHeight > pageBottom()) {
      doc.addPage();
      drawHeader();
      y = doc.page.margins.top + 60;
      drawRow(
        Object.fromEntries(columns.map((c) => [c.key, c.label])),
        true
      );
    }

    drawRow(rowData);
  });

  drawRow(
    {
      name: "TOTAL",
      paid: money(summary?.total_collection),
    },
    true
  );

  doc
    .fontSize(9)
    .font(fontName("regular"))
    .text(
      `Page ${pagination?.page || 1} / ${pagination?.total_pages || 1} | Total Records: ${
        pagination?.total || details.length
      }`,
      doc.page.margins.left,
      y + 10
    );

  doc.end();

  return done;
}
