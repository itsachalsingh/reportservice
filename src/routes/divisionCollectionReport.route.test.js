import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { divisionCollectionReportBodySchema } from "./divisionCollectionReport.route.js";

const DATE_ALIASES = [
  "start_date",
  "startDate",
  "date_from",
  "dateFrom",
  "from_date",
  "from",
  "end_date",
  "endDate",
  "date_to",
  "dateTo",
  "to_date",
  "to",
];

test("division collection date filters are optional but validate supplied dates", async () => {
  const app = Fastify();
  app.post(
    "/",
    { schema: { body: divisionCollectionReportBodySchema } },
    async () => ({ ok: true })
  );

  try {
    assert.equal((await app.inject({ method: "POST", url: "/", payload: {} })).statusCode, 200);

    for (const field of DATE_ALIASES) {
      for (const value of ["", null, "2026-09-28"]) {
        const response = await app.inject({
          method: "POST",
          url: "/",
          payload: { [field]: value },
        });
        assert.equal(response.statusCode, 200, `${field} should accept ${value}`);
      }
    }

    const invalid = await app.inject({
      method: "POST",
      url: "/",
      payload: { start_date: "28-09-2026" },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});
