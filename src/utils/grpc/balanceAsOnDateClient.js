import path from "path";
import { fileURLToPath } from "url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.join(__dirname, "..", "..", "grpc", "proto", "balanceAsOnDateReport.proto");
const definition = protoLoader.loadSync(protoPath, {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const proto = grpc.loadPackageDefinition(definition).balanceasondate;
let client;

function getClient() {
  if (!client) {
    const target = process.env.BILLING_SERVICE_GRPC_TARGET ||
      `${process.env.BILLING_SERVICE_GRPC_HOST || "billing-service"}:${process.env.BILLING_SERVICE_GRPC_PORT || "50057"}`;
    client = new proto.BalanceAsOnDateReportService(target, grpc.credentials.createInsecure(), {
      "grpc.max_receive_message_length": -1,
    });
  }
  return client;
}

export function fetchBalanceAsOnDate(input = {}) {
  const clean = (value) => value == null ? "" : String(value).trim();
  const payload = {
    as_on_date: clean(input.as_on_date || input.asOnDate || input.date),
    group_by: clean(input.group_by || input.groupBy || "collection_center"),
    department_id: clean(input.department_id || input.departmentId),
    division_id: clean(input.division_id || input.divisionId),
    collection_center_id: clean(input.collection_center_id || input.collectionCenterId),
    scheme_id: clean(input.scheme_id || input.schemeId),
  };
  return new Promise((resolve, reject) => {
    getClient().GetBalanceAsOnDateReport(payload, (error, response) => {
      if (error) return reject(error);
      resolve(response || {});
    });
  });
}
