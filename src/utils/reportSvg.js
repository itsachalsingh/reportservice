const XML_RE = /[&<>"']/g;
const XML_REPLACEMENTS = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value) {
  return String(value ?? "").replace(XML_RE, (ch) => XML_REPLACEMENTS[ch] || ch);
}

function truncateText(text, maxChars) {
  const raw = String(text ?? "");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function renderConnectionCategoryReportSvg({
  title = "",
  subtitle = "",
  rows = [],
} = {}) {
  const header = [
    "Connection Category",
    "Tax_Non",
    "Total(C/D)",
    "Water(C)",
    "Sewer(C)",
    "Both(C)",
    "Water(D)",
    "Sewer(D)",
    "Both(D)",
  ];

  const colWidths = [220, 80, 95, 85, 85, 85, 85, 85, 85];
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const paddingX = 24;
  const titleHeight = 28;
  const subtitleHeight = subtitle ? 20 : 0;
  const headerHeight = 34;
  const rowHeight = 28;
  const tableHeight = headerHeight + rows.length * rowHeight;
  const totalHeight =
    paddingX + titleHeight + subtitleHeight + 12 + tableHeight + paddingX;

  let x = paddingX;
  const headerCells = header
    .map((label, index) => {
      const cell = `<text x="${x + 8}" y="${paddingX + titleHeight + subtitleHeight + 26}" font-size="12" font-weight="600" fill="#1f2937">${escapeXml(label)}</text>`;
      x += colWidths[index];
      return cell;
    })
    .join("");

  let y = paddingX + titleHeight + subtitleHeight + headerHeight;
  const rowCells = rows
    .map((row) => {
      let cx = paddingX;
      const values = [
        row.connection_category,
        row.tax_non,
        row.total_cd,
        row.water_c,
        row.sewer_c,
        row.both_c,
        row.water_d,
        row.sewer_d,
        row.both_d,
      ];

      const rowText = values
        .map((value, index) => {
          const text = truncateText(value, index === 0 ? 28 : 10);
          const cell = `<text x="${cx + 8}" y="${y + 19}" font-size="12" fill="#111827">${escapeXml(text)}</text>`;
          cx += colWidths[index];
          return cell;
        })
        .join("");

      const rowLine = `<line x1="${paddingX}" y1="${y}" x2="${paddingX + totalWidth}" y2="${y}" stroke="#e5e7eb" />`;
      y += rowHeight;
      return `${rowLine}${rowText}`;
    })
    .join("");

  const gridLines = colWidths
    .reduce((lines, w, idx) => {
      const xPos = paddingX + colWidths.slice(0, idx + 1).reduce((s, v) => s + v, 0);
      if (idx === colWidths.length - 1) return lines;
      lines.push(
        `<line x1="${xPos}" y1="${paddingX + titleHeight + subtitleHeight}" x2="${xPos}" y2="${paddingX + titleHeight + subtitleHeight + tableHeight}" stroke="#e5e7eb" />`
      );
      return lines;
    }, [])
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${paddingX * 2 + totalWidth}" height="${totalHeight}" viewBox="0 0 ${paddingX * 2 + totalWidth} ${totalHeight}">
  <rect x="0" y="0" width="${paddingX * 2 + totalWidth}" height="${totalHeight}" fill="#ffffff" />
  <text x="${paddingX}" y="${paddingX + 18}" font-size="16" font-weight="700" fill="#111827">${escapeXml(title)}</text>
  ${
    subtitle
      ? `<text x="${paddingX}" y="${paddingX + 18 + 18}" font-size="12" fill="#4b5563">${escapeXml(subtitle)}</text>`
      : ""
  }
  <rect x="${paddingX}" y="${paddingX + titleHeight + subtitleHeight}" width="${totalWidth}" height="${headerHeight}" fill="#f3f4f6" stroke="#e5e7eb" />
  ${headerCells}
  <rect x="${paddingX}" y="${paddingX + titleHeight + subtitleHeight + headerHeight}" width="${totalWidth}" height="${rows.length * rowHeight}" fill="#ffffff" stroke="#e5e7eb" />
  ${gridLines}
  ${rowCells}
</svg>`;
}

export function renderConnectionCountReportSvg({
  title = "",
  subtitle = "",
  rows = [],
} = {}) {
  const header = ["Consumer Category", "Connection Count"];
  const colWidths = [320, 160];
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const paddingX = 24;
  const titleHeight = 28;
  const subtitleHeight = subtitle ? 20 : 0;
  const headerHeight = 34;
  const rowHeight = 28;
  const tableHeight = headerHeight + rows.length * rowHeight;
  const totalHeight =
    paddingX + titleHeight + subtitleHeight + 12 + tableHeight + paddingX;

  let x = paddingX;
  const headerCells = header
    .map((label, index) => {
      const cell = `<text x="${x + 8}" y="${paddingX + titleHeight + subtitleHeight + 26}" font-size="12" font-weight="600" fill="#1f2937">${escapeXml(label)}</text>`;
      x += colWidths[index];
      return cell;
    })
    .join("");

  let y = paddingX + titleHeight + subtitleHeight + headerHeight;
  const rowCells = rows
    .map((row) => {
      let cx = paddingX;
      const values = [row.category, row.count];

      const rowText = values
        .map((value, index) => {
          const text = truncateText(value, index === 0 ? 36 : 12);
          const cell = `<text x="${cx + 8}" y="${y + 19}" font-size="12" fill="#111827">${escapeXml(text)}</text>`;
          cx += colWidths[index];
          return cell;
        })
        .join("");

      const rowLine = `<line x1="${paddingX}" y1="${y}" x2="${paddingX + totalWidth}" y2="${y}" stroke="#e5e7eb" />`;
      y += rowHeight;
      return `${rowLine}${rowText}`;
    })
    .join("");

  const gridLines = colWidths
    .reduce((lines, w, idx) => {
      const xPos =
        paddingX + colWidths.slice(0, idx + 1).reduce((s, v) => s + v, 0);
      if (idx === colWidths.length - 1) return lines;
      lines.push(
        `<line x1="${xPos}" y1="${paddingX + titleHeight + subtitleHeight}" x2="${xPos}" y2="${paddingX + titleHeight + subtitleHeight + tableHeight}" stroke="#e5e7eb" />`
      );
      return lines;
    }, [])
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${paddingX * 2 + totalWidth}" height="${totalHeight}" viewBox="0 0 ${paddingX * 2 + totalWidth} ${totalHeight}">
  <rect x="0" y="0" width="${paddingX * 2 + totalWidth}" height="${totalHeight}" fill="#ffffff" />
  <text x="${paddingX}" y="${paddingX + 18}" font-size="16" font-weight="700" fill="#111827">${escapeXml(title)}</text>
  ${
    subtitle
      ? `<text x="${paddingX}" y="${paddingX + 18 + 18}" font-size="12" fill="#4b5563">${escapeXml(subtitle)}</text>`
      : ""
  }
  <rect x="${paddingX}" y="${paddingX + titleHeight + subtitleHeight}" width="${totalWidth}" height="${headerHeight}" fill="#f3f4f6" stroke="#e5e7eb" />
  ${headerCells}
  <rect x="${paddingX}" y="${paddingX + titleHeight + subtitleHeight + headerHeight}" width="${totalWidth}" height="${rows.length * rowHeight}" fill="#ffffff" stroke="#e5e7eb" />
  ${gridLines}
  ${rowCells}
</svg>`;
}
