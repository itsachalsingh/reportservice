import test from "node:test";
import assert from "node:assert/strict";

import { resolveBillChargeBreakup } from "../src/utils/billChargeTotals.js";

test("uses flat source_totals charge fields returned by payment-service", () => {
  const sourceTotals = {
    water_charges: 1250,
    sewer_charges: 350,
    meter_charges: 100,
    fine: 25,
  };

  assert.equal(resolveBillChargeBreakup({ source_totals: sourceTotals }), sourceTotals);
});

test("prefers paid_breakup when the upstream response provides it", () => {
  const paidBreakup = {
    water_charges: 500,
    sewer_charges: 150,
    meter_charges: 50,
    fine: 10,
  };

  assert.equal(
    resolveBillChargeBreakup({
      source_totals: {
        water_charges: 1250,
        paid_breakup: paidBreakup,
      },
    }),
    paidBreakup
  );
});

test("returns an empty breakup for missing or invalid source totals", () => {
  assert.deepEqual(resolveBillChargeBreakup(), {});
  assert.deepEqual(resolveBillChargeBreakup({ source_totals: [] }), {});
});
