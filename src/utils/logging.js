import process from "node:process";
import { emitOpenTelemetryLog, sanitizeValue } from "./otel-log.util.js";

const levels = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };
const consoleLevels = { log: "info", info: "info", warn: "warn", error: "error", debug: "debug", trace: "trace" };

for (const [method, level] of Object.entries(consoleLevels)) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    emitOpenTelemetryLog(level, `console.${method}`, { args });
    original(...args);
  };
}

export const logStream = {
  write(line) {
    try {
      const record = sanitizeValue(JSON.parse(line));
      const written = process.stdout.write(`${JSON.stringify(record)}\n`);
      emitOpenTelemetryLog(levels[record.level] || "info", "fastify.log", record, record.time);
      return written;
    } catch {
      return process.stdout.write(line);
    }
  },
};
