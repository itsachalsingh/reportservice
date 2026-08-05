import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const ASSETS_DIR = path.resolve(process.cwd(), "assets");
const asset = (name) => path.join(ASSETS_DIR, name);
const fontAsset = (name) => path.join(ASSETS_DIR, "fonts", name);
const WIDE_LANDSCAPE_PAGE = [1200, 595.28];

function money(value) {
  const amount = Math.round(Number(value) || 0);
  return amount.toLocaleString("en-IN");
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

function firstDisplayText(...values) {
  for (const value of values) {
    const text = sanitizeCellText(value);
    if (!text || text.toLowerCase() === "all" || isObjectIdLike(text)) continue;
    return text;
  }
  return null;
}

function hasRequestedHeaderFilter(...values) {
  return values.some((value) => {
    const text = sanitizeCellText(value);
    return Boolean(text && text.toLowerCase() !== "all");
  });
}

function isObjectIdLike(value) {
  return /^[a-f0-9]{24}$/i.test(String(value ?? "").trim());
}

function resolveDepartmentName(...values) {
  for (const value of values) {
    const text = sanitizeCellText(value);
    if (!text) continue;

    const token = text.toUpperCase();
    if (["UJS", "S", "J"].includes(token)) return "Uttarakhand Jal Sansthan";
    if (["UJN", "N"].includes(token)) return "Uttarakhand Jal Nigam";
    if (isObjectIdLike(text)) continue;

    return text;
  }

  return "-";
}

function resolveHeaderLogoPath(department) {
  const token = sanitizeCellText(department).toUpperCase();
  if (token.includes("SANSTHAN") || token === "UJS" || token === "J") {
    return asset("logo2.png");
  }
  return asset("logo3.jpg");
}

function toDateOnlyDisplay(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function toAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function getDisplayedPaidAmount(row = {}) {
  return toAmount(row.paid_amount ?? row.amount);
}

function getDisplayedAdvanceAmount(row = {}) {
  return toAmount(row.excess_amount ?? row.advance);
}

function getDisplayedPreviousAdvanceAmount(row = {}) {
  return toAmount(
    row.previous_advance ??
      row.previousAdvance ??
      row.adv_wb_chrg ??
      row.advWBCharge ??
      row.advanceused ??
      row.advance_used
  );
}

function buildDetailTotals(details = []) {
  return details.reduce(
    (totals, row) => ({
      water: totals.water + toAmount(row.water_charges),
      sewer: totals.sewer + toAmount(row.sewer_charges),
      meter: totals.meter + toAmount(row.meter_rent),
      other: totals.other + toAmount(row.others),
      late: totals.late + toAmount(row.late_fee),
      disc: totals.disc + toAmount(row.discount),
      arrears: totals.arrears + toAmount(row.arrears),
      total: totals.total + toAmount(row.bill_amount),
      paid: totals.paid + getDisplayedPaidAmount(row),
      previousAdvance:
        totals.previousAdvance + getDisplayedPreviousAdvanceAmount(row),
      advance: totals.advance + getDisplayedAdvanceAmount(row),
      balance: totals.balance + toAmount(row.balance),
    }),
    {
      water: 0,
      sewer: 0,
      meter: 0,
      other: 0,
      late: 0,
      disc: 0,
      arrears: 0,
      total: 0,
      paid: 0,
      previousAdvance: 0,
      advance: 0,
      balance: 0,
    }
  );
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
  detailTotalsOverride = null,
} = {}) {
  const doc = new PDFDocument({
    size: WIDE_LANDSCAPE_PAGE,
    margin: 24,
  });

  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  const done = new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
  });

  const watermarkPath = asset("watermark.png");

  const generatedAt = toDisplayDate(new Date());
  registerFonts(doc);
  const firstDetail = Array.isArray(details) && details.length ? details[0] : {};
  const departmentName = resolveDepartmentName(
    payload?.department_name,
    summary?.filters?.department_name,
    firstDetail?.department_name,
    payload?.department,
    summary?.filters?.department,
    firstDetail?.department
  );
  const hasDivisionFilter = hasRequestedHeaderFilter(
    payload?.division_name,
    payload?.division,
    payload?.division_id,
    summary?.filters?.division
  );
  const hasCollectionCenterFilter = hasRequestedHeaderFilter(
    payload?.collection_center_name,
    payload?.collection_center,
    payload?.collection_center_id,
    payload?.collectionCenter,
    summary?.filters?.collection_center
  );
  const divisionName = hasDivisionFilter
    ? firstDisplayText(
        summary?.filters?.division_name,
        payload?.division_name,
        summary?.filters?.division,
        payload?.division,
        firstDetail?.division
      ) || "-"
    : "-";
  const collectionCenterName = hasCollectionCenterFilter
    ? firstDisplayText(
        summary?.filters?.collection_center_name,
        payload?.collection_center_name,
        summary?.filters?.collection_center,
        payload?.collection_center,
        payload?.collectionCenter,
        firstDetail?.collection_center
      ) || "-"
    : "-";
  const logoPath = resolveHeaderLogoPath(departmentName);
  const reportTitle = headerValue(payload?.report_title || "Daily Collection Report");
  const startDate = toDateOnlyDisplay(payload?.start_date || payload?.from_date);
  const endDate = toDateOnlyDisplay(payload?.end_date || payload?.to_date);
  const dateRangeText =
    startDate !== "-" && endDate !== "-" ? `${startDate} to ${endDate}` : startDate;

  function drawHeader(pageDivisionName = divisionName) {
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
      .text(reportTitle, 0, doc.page.margins.top - 2, {
        align: "center",
      });

    doc
      .fontSize(11)
      .font(fontName("bold"))
      .text(headerValue(pageDivisionName), 0, doc.page.margins.top + 15, {
        align: "center",
      });

    doc
      .fontSize(8)
      .font(fontName("bold"))
      .text(
        `Department: ${headerValue(departmentName)}`,
        doc.page.margins.left,
        doc.page.margins.top - 13,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "right",
        }
      )
      .text(
        `Division: ${headerValue(pageDivisionName)}`,
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

    doc
      .fontSize(9)
      .font(fontName("regular"))
      .text(
        `Date: ${dateRangeText}  Generated At: ${generatedAt}`,
        0,
        doc.page.margins.top + 29,
        { align: "center" }
      );
  }

  let y = doc.page.margins.top + 60;

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

  const paymentMethodColWidth = availableWidth / paymentMethodItems.length;

  function drawSummary() {
    doc
      .fontSize(10)
      .font(fontName("bold"))
      .text(totalPaymentText, doc.page.margins.left, y, {
        width: availableWidth,
        align: "left",
      });

    y += 14;

    paymentMethodItems.forEach((text, i) => {
      doc
        .fontSize(9)
        .font(fontName("bold"))
        .text(text, doc.page.margins.left + paymentMethodColWidth * i, y, {
          width: paymentMethodColWidth,
        });
    });

    y += 24;
  }

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

    { key: "previousAdvance", label: "Previous Advance", width: 95 },

    { key: "advance", label: "Advance", width: 85 },

    { key: "balance", label: "Balance", width: 85 },
  ];
  const columns = fitColumnsToPage(doc, rawColumns);
  const columnsByKey = Object.fromEntries(columns.map((col) => [col.key, col]));
  const detailTotals = detailTotalsOverride || buildDetailTotals(details);

  const numericKeys = new Set([
    "water",
    "sewer",
    "meter",
    "other",
    "late",
    "disc",
    "arrears",
    "total",
    "paid",
    "previousAdvance",
    "advance",
    "balance",
  ]);

  const wrapKeys = new Set([
    "consumer",
    "name",
    "receipt",
    "date",
    ...numericKeys,
  ]);

  function normalizeRenderedCellText(value) {
    return String(value ?? "").replace(/\r/g, "").trim();
  }

  function widthOfCellText(text) {
    return doc.widthOfString(text, { lineGap: 0 });
  }

  function splitTextToFit(text, maxWidth, splitByComma = true) {
    const normalized = normalizeRenderedCellText(text);
    if (!normalized) return "";
    if (widthOfCellText(normalized) <= maxWidth) return normalized;

    const tokens = splitByComma && normalized.includes(",")
      ? normalized.match(/[^,]+,?/g) || [normalized]
      : normalized.split("");

    const lines = [];
    let currentLine = "";

    for (const token of tokens) {
      const candidate = currentLine ? `${currentLine}${token}` : token;
      if (currentLine && widthOfCellText(candidate) > maxWidth) {
        lines.push(currentLine);
        currentLine = token;
      } else {
        currentLine = candidate;
      }
    }

    if (currentLine) lines.push(currentLine);

    const output = [];
    for (const line of lines) {
      if (widthOfCellText(line) <= maxWidth) {
        output.push(line);
        continue;
      }

      let charLine = "";
      for (const ch of line.split("")) {
        const candidate = charLine ? `${charLine}${ch}` : ch;
        if (charLine && widthOfCellText(candidate) > maxWidth) {
          output.push(charLine);
          charLine = ch;
        } else {
          charLine = candidate;
        }
      }
      if (charLine) output.push(charLine);
    }

    return output.join("\n");
  }

  function formatNumericCell(key, value, options = {}) {
    const width = Math.max(10, (columnsByKey[key]?.width || 0) - 6);
    const text = money(value);
    doc.font(fontName(options.bold ? "bold" : "regular")).fontSize(8);
    return splitTextToFit(text, width, true);
  }

  function estimateRowHeight(row, options = {}) {
    if (options.isTableHeader) return 22;
    let height = 24;
    doc.font(fontName(options.isHeader ? "bold" : "regular")).fontSize(8);
    columns.forEach((col) => {
      if (!wrapKeys.has(col.key)) return;
      const text = normalizeRenderedCellText(row[col.key] ?? "");
      const align = numericKeys.has(col.key) ? "right" : "left";
      const measured = doc.heightOfString(text, {
        width: Math.max(10, col.width - 6),
        align,
        lineGap: 0,
      });
      height = Math.max(height, Math.min(78, Math.ceil(measured) + 6));
    });
    return height;
  }

  function drawRow(row, options = {}) {
    const rowHeight = estimateRowHeight(row, options);
    let x = doc.page.margins.left;

    if (options.isHeader) {
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
        "previousAdvance",
        "advance",
        "balance",
      ].includes(col.key)
        ? "right"
        : "left";

      const text = normalizeRenderedCellText(row[col.key] ?? "");
      const shouldWrap = options.isTableHeader || wrapKeys.has(col.key);
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

  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 20;

  const tableHeaderRow = Object.fromEntries(columns.map((c) => [c.key, c.label]));
  const tableHeaderHeight = estimateRowHeight(tableHeaderRow, {
    isHeader: true,
    isTableHeader: true,
  });
  const firstPageRowsStartY = doc.page.margins.top + 60 + 38 + tableHeaderHeight;
  const nextPageRowsStartY = doc.page.margins.top + 60 + tableHeaderHeight;

  function getPageDivisionName(pageRows = []) {
    if (hasDivisionFilter) return divisionName;

    const names = [];
    const seen = new Set();
    for (const pageRow of pageRows) {
      const name = firstDisplayText(pageRow?.source?.division);
      if (!name) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      names.push(name);
    }

    return names.length ? names.join(", ") : "-";
  }

  function buildDetailRowData(row, i) {
    return {
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

      total: formatNumericCell("total", row.bill_amount),

      paid: formatNumericCell("paid", row.paid_amount ?? row.amount),

      previousAdvance: formatNumericCell(
        "previousAdvance",
        getDisplayedPreviousAdvanceAmount(row)
      ),

      water: formatNumericCell("water", row.water_charges),

      sewer: formatNumericCell("sewer", row.sewer_charges),

      meter: formatNumericCell("meter", row.meter_rent),

      other: formatNumericCell("other", row.others),

      late: formatNumericCell("late", row.late_fee),

      disc: formatNumericCell("disc", row.discount),

      arrears: formatNumericCell("arrears", row.arrears),

      advance: formatNumericCell("advance", getDisplayedAdvanceAmount(row)),

      balance: formatNumericCell("balance", row.balance),
    };
  }

  const detailPages = [];
  let currentPageRows = [];
  let currentY = firstPageRowsStartY;

  details.forEach((row, i) => {
    const rowData = buildDetailRowData(row, i);
    const nextHeight = estimateRowHeight(rowData);
    if (currentPageRows.length && currentY + nextHeight > pageBottom()) {
      detailPages.push(currentPageRows);
      currentPageRows = [];
      currentY = nextPageRowsStartY;
    }

    currentPageRows.push({ rowData, source: row });
    currentY += nextHeight;
  });

  if (currentPageRows.length || !detailPages.length) {
    detailPages.push(currentPageRows);
  }

  detailPages.forEach((pageRows, pageIndex) => {
    if (pageIndex > 0) doc.addPage();

    drawHeader(getPageDivisionName(pageRows));
    y = doc.page.margins.top + 60;
    if (pageIndex === 0) drawSummary();
    drawRow(tableHeaderRow, { isHeader: true, isTableHeader: true });

    pageRows.forEach((pageRow) => {
      drawRow(pageRow.rowData);
    });
  });

  const totalsRow = Object.assign(
    {
      consumer: "",
      name: "TOTAL",
      receipt: "",
      date: "",
    },
    Object.fromEntries(
      Object.entries(detailTotals).map(([key, value]) => [
        key,
        formatNumericCell(key, value, { bold: true }),
      ])
    )
  );
  const totalsRowHeight = estimateRowHeight(totalsRow);
  if (y + totalsRowHeight + 24 > pageBottom()) {
    doc.addPage();
    drawHeader();
    y = doc.page.margins.top + 60;
    drawRow(
      Object.fromEntries(columns.map((c) => [c.key, c.label])),
      { isHeader: true, isTableHeader: true }
    );
  }

  drawRow(totalsRow, { isHeader: true });

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
