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
let activeTarget = "";

function getCandidateTargets() {
  const explicitTarget = String(process.env.BILLING_REPORT_GRPC_TARGET || "").trim();
  if (explicitTarget) return [explicitTarget];

  const port = Number(process.env.BILLING_REPORT_GRPC_PORT || 50057);
  const hostsRaw = String(
    process.env.BILLING_REPORT_GRPC_HOSTS || process.env.BILLING_REPORT_GRPC_HOST || ""
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const defaults = ["uwbs-billingservice", "host.docker.internal", "localhost", "127.0.0.1"];
  const seen = new Set();
  const hosts = [...hostsRaw, ...defaults].filter((host) => {
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });

  return hosts.map((host) => `${host}:${port}`);
}

function createClient(target) {
  return new proto.LegacyArrearReportService(
    target,
    grpc.credentials.createInsecure(),
    { "grpc.max_receive_message_length": -1 }
  );
}

function isGrpcUnavailable(error) {
  const code = Number(error?.code);
  return code === grpc.status.UNAVAILABLE || code === grpc.status.DEADLINE_EXCEEDED;
}

async function invokeSummary(client, payload) {
  return new Promise((resolve, reject) => {
    client.GetLegacyArrearDivisionSummary(payload, (error, response) => {
      if (error) return reject(error);
      resolve(response || {});
    });
  });
}

function getClient() {
  if (clientInstance) return clientInstance;
  const candidates = getCandidateTargets();
  activeTarget = candidates[0] || "localhost:50057";
  clientInstance = createClient(activeTarget);
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

  const candidates = getCandidateTargets();
  let lastError = null;

  if (clientInstance && activeTarget) {
    try {
      return await invokeSummary(clientInstance, payload);
    } catch (error) {
      lastError = error;
      if (!isGrpcUnavailable(error)) throw error;
      clientInstance = null;
      activeTarget = "";
    }
  }

  for (const target of candidates) {
    const client = createClient(target);
    try {
      const response = await invokeSummary(client, payload);
      clientInstance = client;
      activeTarget = target;
      return response;
    } catch (error) {
      lastError = error;
      if (!isGrpcUnavailable(error)) throw error;
    }
  }

  throw lastError || new Error("Unable to connect to legacy arrear gRPC service");
}
