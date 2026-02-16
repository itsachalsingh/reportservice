import path from "path";
import { fileURLToPath } from "url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.join(
  __dirname,
  "..",
  "..",
  "grpc",
  "proto",
  "legacyArrearReport.proto"
);

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition).legacyarrear;

let clientInstance = null;

function getClient() {
  if (clientInstance) return clientInstance;

  const host = process.env.BILLING_REPORT_GRPC_HOST || "uwbs-billingservice";
  const port = Number(process.env.BILLING_REPORT_GRPC_PORT || 50057);
  const target = `${host}:${port}`;

  clientInstance = new proto.LegacyArrearReportService(
    target,
    grpc.credentials.createInsecure(),
    { "grpc.max_receive_message_length": -1 }
  );

  return clientInstance;
}

function cleanString(value) {
  if (value == null) return "";
  return String(value).trim();
}

export async function fetchLegacyArrearDivisionSummary(input = {}) {
  const payload = {
    department: cleanString(input.department),
    department_id: cleanString(input.department_id || input.departmentId),
    departmentId: cleanString(input.departmentId),
    division: cleanString(input.division),
    division_id: cleanString(input.division_id || input.divisionId),
    divisionId: cleanString(input.divisionId),
    collection_center: cleanString(input.collection_center || input.collectionCenter),
    collection_center_id: cleanString(
      input.collection_center_id || input.collectionCenterId
    ),
    collectionCenter: cleanString(input.collectionCenter),
    collectionCenterId: cleanString(input.collectionCenterId),
    scheme: cleanString(input.scheme),
    scheme_id: cleanString(input.scheme_id || input.schemeId),
    schemeId: cleanString(input.schemeId),
    group_by_collection_center: Boolean(
      input.group_by_collection_center ?? input.groupByCollectionCenter
    ),
    groupByCollectionCenter: Boolean(input.groupByCollectionCenter),
    group_by_scheme: Boolean(input.group_by_scheme ?? input.groupByScheme),
    groupByScheme: Boolean(input.groupByScheme),
  };

  const client = getClient();

  return new Promise((resolve, reject) => {
    client.GetLegacyArrearDivisionSummary(payload, (error, response) => {
      if (error) return reject(error);
      resolve(response || {});
    });
  });
}

