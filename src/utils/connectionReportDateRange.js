const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function getRollingConnectionReportStartDate(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  const startMatch = DATE_ONLY_RE.exec(start);
  const endMatch = DATE_ONLY_RE.exec(end);

  if (!startMatch || !endMatch) return start;

  const [, startYear, startMonth, startDay] = startMatch;
  const [, endYear, endMonth] = endMatch;
  if (startYear !== endYear || startMonth !== endMonth || startDay !== "01") {
    return start;
  }

  return `${Number(endYear) - 1}-04-01`;
}
