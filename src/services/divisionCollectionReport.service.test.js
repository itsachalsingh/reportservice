import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDivisionCollectionScopes,
  buildDivisionCollectionTotals,
  mergeDivisionCollectionRows,
  resolveDivisionCollectionPeriods,
  toDivisionCollectionSpreadsheetRow,
} from "./divisionCollectionReport.service.js";

test("merges billing and payment data by division and keeps empty master divisions", () => {
  const rows = mergeDivisionCollectionRows({
    masterDivisions: [
      { id: "d1", name: "North" },
      { id: "d2", name: "South" },
    ],
    billingRows: [{
      division_id: "d1",
      division_name: "Old North Name",
      total_bills: "2",
      pending_bills: "1",
      total_amount: 125.5,
    }],
    paymentRows: [{
      division_id: "d1",
      total_collection: 100,
      online_payments: 75,
      offline_payments: 20,
      csc: 5,
      payu: 50,
    }],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    division_id: "d1",
    division_name: "North",
    total_bills: 2,
    pending_bills: 1,
    total_unpaid_bills: 0,
    total_amount: 126,
    total_current_amount: 0,
    total_old_arrear_amount: 0,
    total_collection: 100,
    online_payments: 75,
    offline_payments: 20,
    csc: 5,
    bbps: 0,
    payu: 50,
    sabpaisa: 0,
    mwipe: 0,
    razorpay: 0,
  });
  assert.equal(rows[1].division_name, "South");
  assert.equal(rows[1].total_bills, 0);
});

test("builds grand totals and the exact workbook headers", () => {
  const rows = mergeDivisionCollectionRows({
    billingRows: [{ division_id: "d1", division_name: "North", total_bills: 2 }],
    paymentRows: [{ division_id: "d1", total_collection: 10 }],
  });
  const totals = buildDivisionCollectionTotals(rows);
  const spreadsheet = toDivisionCollectionSpreadsheetRow({
    division_name: "Grand Total",
    ...totals,
  });

  assert.equal(totals.total_bills, 2);
  assert.equal(totals.total_collection, 10);
  assert.deepEqual(Object.keys(spreadsheet), [
    "Division Name",
    "Total Bills",
    "Pending Bills",
    "Total Unpaid Bills",
    "Total Amount",
    "Total Current Amount",
    "Total Old Arrear Amount in previous bill",
    "Total Collection",
    "Online Payments",
    "Offline Payments",
    "CSC",
    "BBPS",
    "PayU",
    "Sabpaisa",
    "mwipe",
    "Razorpay",
  ]);
});

test("uses the current financial cycle through yesterday by default", () => {
  const result = resolveDivisionCollectionPeriods(
    {},
    new Date("2026-09-23T10:00:00.000Z")
  );

  assert.equal(result.start_date, "2026-04-01");
  assert.equal(result.end_date, "2026-09-22");
  assert.equal(result.includes_today, false);
  assert.deepEqual(result.periods, [
    {
      label: "2026-04-01 to 2026-09-22",
      start_date: "2026-04-01",
      end_date: "2026-09-22",
    },
  ]);
});

test("supports a requested financial cycle and explicit dates", () => {
  const now = new Date("2026-09-23T10:00:00.000Z");
  assert.equal(
    resolveDivisionCollectionPeriods({ include_today: true }, now).end_date,
    "2026-09-23"
  );
  assert.deepEqual(
    resolveDivisionCollectionPeriods({ financial_year: "2025-26" }, now),
    {
      start_date: "2025-04-01",
      end_date: "2026-03-31",
      cutoff_date: "2026-03-31",
      includes_today: false,
      periods: [{
        label: "2025-04-01 to 2026-03-31",
        start_date: "2025-04-01",
        end_date: "2026-03-31",
      }],
    }
  );
  const custom = resolveDivisionCollectionPeriods({
    start_date: "2025-02-01",
    end_date: "2026-03-31",
  }, now);
  assert.equal(custom.start_date, "2025-02-01");
  assert.equal(custom.end_date, "2026-03-31");
});

test("builds payment scopes from billing and master divisions", () => {
  assert.deepEqual(
    buildDivisionCollectionScopes({
      billingRows: [
        { division_id: "d1", division_name: "Old North", bill_numbers: ["B1"] },
        { division_id: "d2", division_name: "South", bill_numbers: ["B2"] },
      ],
      masterDivisions: [{ id: "d1", name: "North" }, { id: "d3", name: "East" }],
    }),
    [
      { division_id: "d1", division_name: "North", bill_numbers: ["B1"] },
      { division_id: "d2", division_name: "South", bill_numbers: ["B2"] },
      { division_id: "d3", division_name: "East", bill_numbers: [] },
    ]
  );
});
