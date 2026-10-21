# Village billing report

The report is generated and its background jobs are stored by reportservice. The public browser route is exposed through the API gateway's reportservice proxy:

- `GET /adminreports/api/village-billing-report`
- `GET /adminreports/api/village-billing-report/jobs/:id`
- `GET /adminreports/api/village-billing-report/jobs/:id/result`

The frontend calls the `/adminreports/api/...` routes directly. No browser-facing village report route is registered in billingservice.

Reportservice fetches the filtered connection pages from adminservice over gRPC. It sends consumer-code batches to billingservice's `GetLatestVillageBillingRows` gRPC method on port `50057`; billingservice queries its own billing collection and returns the latest reportable bill for each code. Reportservice combines the results and saves queued report output to its MongoDB GridFS bucket.

Configure the reportservice deployment with its normal `MONGO_URI`, `RABBITMQ_URI`, and `PORT`, plus the upstream gRPC targets if the defaults do not match the deployment:

- `ADMIN_SERVICE_GRPC_HOST` and `ADMIN_SERVICE_GRPC_PORT` (defaults `admin-service:50051`)
- `BILLING_SERVICE_GRPC_HOST` and `BILLING_SERVICE_GRPC_PORT` (defaults `billing-service:50057`)
- `VILLAGE_REPORT_BILLING_RPC_TIMEOUT_MS` (defaults to `120000`)

The old browser URL remains usable when the billingservice proxy and `REPORT_SERVICE_URL` are deployed. The reportservice's direct API routes are under `/api/village-billing-report`.
