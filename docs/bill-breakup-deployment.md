# Grouped bill breakup deployment

Deploy `uwbs-billingservice` first, then `reportservice`. Both services have an
additive update to `billCollectionSummaryReport.proto`. Old report clients remain
compatible with the new billing service. The new report service requires the new
billing service and reports an explicit error if grouped details are unavailable.

The report now requests all group breakup totals in one gRPC call. Billing runs
two aggregations regardless of scheme count: active amounts and cancellation/
waiver totals. All grouping modes and PDF exports use these totals. Sorting and
pagination remain in the report service, after grouped totals are available, to
preserve the existing amount sort and pagination contract.

The waiver model declares an index on `bill_id`. Verify that this index exists in
the deployed database; installations that disable Mongoose automatic index
creation must create it explicitly on the collection used by `WaivedOffTariff`:

```javascript
db.getCollection('waivedofftariffs').createIndex({ bill_id: 1 })
```

Do not use `syncIndexes` for this change, since it can remove unrelated indexes.

Verify a representative division and bill period against the previous report:
overall totals, each scheme's rounded charges, paid amounts, advance amounts,
cancelled and waived amounts, amount ordering, subsequent pages, and PDF output.
Measure production response time and inspect MongoDB execution plans if the two
remaining aggregations are slow. Local regression tests verify shared calculation
expressions, constant aggregation count, and gRPC serialization; they do not
measure production MongoDB performance.

Run the focused tests:

```text
cd uwbs-billingservice
node node_modules/jest/bin/jest.js src/services/bill.collection.summary.report.service.test.js --runInBand

cd ../reportservice
node --test src/routes/billAmountBreakupSummary.route.node-test.js
```
