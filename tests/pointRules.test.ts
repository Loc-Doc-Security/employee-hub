// Automatic point rules: who's due, for which period (payment is once per period, enforced by the database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueForRule } from "../server/lib/points";

const people = [
  { id: "bday-today", birthday_md: "10-16", hired_on: "2019-03-02" },
  { id: "bday-5-days-ago", birthday_md: "10-11", hired_on: null },
  { id: "bday-next-week", birthday_md: "10-23", hired_on: null },
  { id: "leapling", birthday_md: "02-29", hired_on: null },
  { id: "new-hire", birthday_md: null, hired_on: "2026-10-12" },
  { id: "anniversary", birthday_md: null, hired_on: "2021-10-16" },
  { id: "hired-today", birthday_md: null, hired_on: "2026-10-16" },
];

test("birthday: today, plus a 7-day catch-up, never early", () => {
  const due = dueForRule({ trigger: "birthday", effective_from: null }, people, "2026-10-16").map((d) => `${d.employeeId}:${d.period}`);
  assert.deepEqual(due.sort(), ["bday-5-days-ago:2026", "bday-today:2026"]);
});

test("Feb 29 birthdays are paid on Feb 28 in non-leap years", () => {
  assert.deepEqual(dueForRule({ trigger: "birthday", effective_from: null }, people, "2027-02-28").map((d) => d.employeeId), ["leapling"]);
});

test("on hire: only people hired since the rule took effect (no back-pay), paid once", () => {
  const due = dueForRule({ trigger: "on_hire", effective_from: "2026-10-10" }, people, "2026-10-16");
  assert.deepEqual(due.map((d) => d.employeeId).sort(), ["hired-today", "new-hire"]);
  assert.ok(due.every((d) => d.period === "once"));
  assert.deepEqual(dueForRule({ trigger: "on_hire", effective_from: null }, people, "2026-10-16"), [], "no amount yet = no effective date = nobody");
});

test("work anniversary: from year one, not on the hire date itself", () => {
  const due = dueForRule({ trigger: "hire_anniversary", effective_from: null }, people, "2026-10-16").map((d) => d.employeeId);
  assert.ok(due.includes("anniversary"));
  assert.ok(!due.includes("hired-today"));
});
