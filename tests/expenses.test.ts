// Receipt compliance is weighted by purchases, never an average of percentages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, pct } from "../server/lib/expenses";

test("weighted: 99 of 100 is 99% even with one person at 0%", () => {
  const r = aggregate([
    { employeeId: "a", department: "Service", purchases: 99, receipts: 99 },
    { employeeId: "b", department: "Service", purchases: 1, receipts: 0 },
  ]);
  assert.equal(r.departments[0].percent, 99);
  assert.equal(r.company.percent, 99);
});

test("no purchases shows null, not 0%; sorted best first", () => {
  const r = aggregate([
    { employeeId: "a", department: "Lab", purchases: 0, receipts: 0 },
    { employeeId: "b", department: "Service", purchases: 10, receipts: 5 },
    { employeeId: "c", department: "Accounting", purchases: 4, receipts: 4 },
  ]);
  assert.deepEqual(r.departments.map((d) => [d.department, d.percent]), [["Accounting", 100], ["Service", 50], ["Lab", null]]);
  assert.equal(pct(0, 0), null);
  assert.equal(pct(4, 15), 26.7);
});
