// Cleanliness audit week: Wed 9am Eastern → next Tue night, locked Wed 00:00–09:00.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditWeekStart, isAuditLocked, ptoWeekForAuditWeek, auditWeekForPtoWeek } from "../server/lib/weeks";

test("Wednesday after 9am opens a new audit week", () => {
  assert.equal(auditWeekStart(new Date("2026-10-14T13:30:00Z")), "2026-10-14"); // Wed 9:30am ET
});

test("Wednesday before 9am is still the previous week (and locked)", () => {
  const wedEarly = new Date("2026-10-14T12:00:00Z"); // Wed 8:00am ET
  assert.equal(auditWeekStart(wedEarly), "2026-10-07");
  assert.equal(isAuditLocked(wedEarly), true);
  assert.equal(isAuditLocked(new Date("2026-10-14T13:30:00Z")), false);
});

test("Tuesday night belongs to the week that opened the Wednesday before", () => {
  assert.equal(auditWeekStart(new Date("2026-10-21T03:30:00Z")), "2026-10-14"); // Tue 11:30pm ET
});

test("PTO work week (Monday) ↔ audit week (that Wednesday)", () => {
  assert.equal(ptoWeekForAuditWeek("2026-10-14"), "2026-10-12");
  assert.equal(auditWeekForPtoWeek("2026-10-12"), "2026-10-14");
});
