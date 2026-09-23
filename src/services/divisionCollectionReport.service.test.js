import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDivisionCollectionTotals,
  mergeDivisionCollectionRows,
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
    total_amount: 125.5,
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
