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
  "billCollectionSummaryReport.proto"
);

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition).billcollectionsummary;

let clientInstance = null;
const DEFAULT_HOST =
  process.env.BILLING_SERVICE_GRPC_HOST ||
  process.env.BILLING_REPORT_GRPC_HOST ||
  "billing-service";
const DEFAULT_PORT =
  process.env.BILLING_SERVICE_GRPC_PORT ||
  process.env.BILLING_REPORT_GRPC_PORT ||
  "50057";

function getServerAddress() {
  const explicitTarget = String(
    process.env.BILLING_SERVICE_GRPC_TARGET ||
      process.env.BILLING_REPORT_GRPC_TARGET ||
      ""
  ).trim();
  if (explicitTarget) return explicitTarget;
  return `${DEFAULT_HOST}:${DEFAULT_PORT}`;
}

function createClient(target) {
  return new proto.BillCollectionSummaryReportService(
    target,
    grpc.credentials.createInsecure(),
    { "grpc.max_receive_message_length": -1 }
  );
}

function isGrpcUnavailable(error) {
  const code = Number(error?.code);
  return code === grpc.status.UNAVAILABLE || code === grpc.status.DEADLINE_EXCEEDED;
}

function toDebugError(error, meta = {}) {
  const err =
    error instanceof Error
      ? error
      : new Error(error?.message || "Bill collection summary gRPC call failed");
  err.grpcDebug = {
    target: getServerAddress(),
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    grpcCode: error?.code ?? null,
    grpcDetails: error?.details ?? null,
    ...meta,
  };
  return err;
}

function cleanString(value) {
  if (value == null) return "";
  return String(value).trim();
}

async function invokeSummary(client, payload) {
  return new Promise((resolve, reject) => {
    client.GetBillCollectionSummary(payload, (error, response) => {
      if (error) return reject(error);
      resolve(response || {});
    });
  });
}

function getClient() {
  if (clientInstance) return clientInstance;
  clientInstance = createClient(getServerAddress());
  return clientInstance;
}

export async function fetchBillCollectionSummary(input = {}) {
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
    district: cleanString(input.district),
    area_type: cleanString(input.area_type || input.areaType),
    areaType: cleanString(input.areaType),
    ward: cleanString(input.ward),
    village: cleanString(input.village),
    start_date: cleanString(input.start_date || input.startDate || input.from_date || input.from),
    startDate: cleanString(input.startDate),
    from_date: cleanString(input.from_date),
    from: cleanString(input.from),
    end_date: cleanString(input.end_date || input.endDate || input.to_date || input.to),
    endDate: cleanString(input.endDate),
    to_date: cleanString(input.to_date),
    to: cleanString(input.to),
    bill_month: cleanString(input.bill_month || input.billMonth || input.month),
    billMonth: cleanString(input.billMonth),
    month: cleanString(input.month),
  };

  try {
    return await invokeSummary(getClient(), payload);
  } catch (error) {
    if (!isGrpcUnavailable(error)) {
      throw toDebugError(error, { phase: "initial_call" });
    }
    clientInstance = null;
    try {
      return await invokeSummary(getClient(), payload);
    } catch (retryError) {
      throw toDebugError(retryError, { phase: "retry_call" });
    }
  }
}
