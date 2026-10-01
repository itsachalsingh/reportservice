import test from 'node:test';
import assert from 'node:assert/strict';
import protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { buildGroupWiseDetails } from './billAmountBreakupSummary.route.js';

test('grouped breakup survives gRPC serialization and preserves the report fields', () => {
  const defs = protoLoader.loadSync(fileURLToPath(new URL('../grpc/proto/billCollectionSummaryReport.proto', import.meta.url)), {
    keepCase: true, longs: String, defaults: true,
  });
  const wire = defs['billcollectionsummary.BillCollectionSummaryReportService'].GetBillCollectionSummary;
  const summary = wire.responseDeserialize(wire.responseSerialize({ data: {
    breakup_details_available: true,
    scheme_breakup: [{ group_id: 's1', totals: {
      total_bill_generated_count: 3, total_bill_paid_count: 1,
      total_bill_generated_value_rounded_rupees: 302,
      total_bill_waived_off_count: 1, total_bill_waived_off_amount_rounded_rupees: 51,
      total_advance_rounded_rupees: 10, total_advance_used_rounded_rupees: 7,
      total_late_fee_arrear_rounded_rupees: 4, total_late_fine_rounded_rupees: 2,
    } }],
  } }));
  const rows = buildGroupWiseDetails({ type: 'scheme', summary, rows: [{ scheme_id: 's1', scheme_name: 'Master name' }] });
  assert.equal(rows[0].scheme_name, 'Master name');
  assert.equal(rows[0].total_amount, 302);
  assert.equal(rows[0].total_bill_paid_count, 1);
  assert.equal(rows[0].total_bill_waived_off_amount, 51);
  assert.equal(rows[0].total_bill_wavied_off_amount, 51);
  assert.equal(rows[0].total_advance, 17);
  assert.equal(rows[0].total_arrear, 6);
});

test('explicitly selected group with no active bills remains a zero row', () => {
  for (const type of ['division', 'collection_center', 'scheme']) {
    const rows = buildGroupWiseDetails({ type, summary: { data: { breakup_details_available: true } },
      rows: [{ [type + '_id']: 'empty', [type + '_name']: 'Empty' }] });
    assert.equal(rows[0].total_amount, 0);
    assert.equal(rows[0].total_bill_generated_count, 0);
  }
});

test('old billing service fails clearly instead of silently returning wrong amounts', () => {
  assert.throws(() => buildGroupWiseDetails({ summary: { data: {} } }), /Billing service must be updated/);
});
