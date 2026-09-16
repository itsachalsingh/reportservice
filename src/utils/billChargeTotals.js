export function resolveBillChargeBreakup(totals = {}) {
  const sourceTotals = totals?.source_totals;
  if (!sourceTotals || typeof sourceTotals !== "object" || Array.isArray(sourceTotals)) {
    return {};
  }

  const paidBreakup = sourceTotals.paid_breakup;
  if (paidBreakup && typeof paidBreakup === "object" && !Array.isArray(paidBreakup)) {
    return paidBreakup;
  }

  // The payment-service currently returns charge fields directly under
  // source_totals. Keep supporting paid_breakup for backward compatibility.
  return sourceTotals;
}
