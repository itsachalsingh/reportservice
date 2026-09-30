import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyIncomePayload } from "./dailyIncomeReport.service.js";

test("daily income payload forwards the created_by filter", () => {
  const creatorId = "6a4cbd2a31e003c309fa537a";

  assert.equal(
    buildDailyIncomePayload({ created_by: creatorId }).created_by,
    creatorId
  );
  assert.equal(
    buildDailyIncomePayload({ createdBy: creatorId }).created_by,
    creatorId
  );
});
