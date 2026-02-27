import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.join(__dirname, "..", "..", "grpc", "proto", "collectionCenter.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const collectionCenterProto = grpc.loadPackageDefinition(packageDefinition).collectionCenter;

let clientInstance = null;

function getClient() {
  if (clientInstance) return clientInstance;

  const host = process.env.ADMIN_SERVICE_GRPC_HOST || "admin-service";
  const port = process.env.ADMIN_SERVICE_GRPC_PORT || "50051";
  const serverAddress = `${host}:${port}`;

  clientInstance = new collectionCenterProto.CollectionCenterService(
    serverAddress,
    grpc.credentials.createInsecure(),
    { "grpc.max_receive_message_length": -1 }
  );

  return clientInstance;
}

export function getCollectionCenters(payload = {}) {
  const client = getClient();
  return new Promise((resolve, reject) => {
    client.getCollectionCenters(payload, (error, response) => {
      if (error) {
        const err = new Error(
          error?.message || "Failed to fetch collection centers"
        );
        err.code = error.code;
        return reject(err);
      }
      resolve(response || {});
    });
  });
}
