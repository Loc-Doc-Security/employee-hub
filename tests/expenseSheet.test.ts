import { test } from "node:test";
import assert from "node:assert/strict";
import { autoSyncDue, parseExpenseSheet, sheetFrom } from "../server/lib/expenseSheet";

const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const people = [
  { id: A, firstName: "Lynn", lastName: "Smith" },
  { id: B, firstName: "Chad", lastName: "Lingafelt" },
  { id: C, firstName: "Mary  Ann", lastName: "Jones" },
];
const header = ["First Name", "Last Name", "Branch", "Departments", "Total Purchases", "Receipts Uploaded", "Percentage Uploaded", "Employee Number"];

test("finds the header row even with a title row above it", () => {
  const r = parseExpenseSheet([["28 Day Rolling Data"], header, ["Lynn", "Smith", "", "", 10, 8, "80%", A]], people);
  assert.deepEqual(r.rows, [{ employeeId: A, purchases: 10, receipts: 8 }]);
});

test("Employee Number wins over the cardholder name; several cards add up", () => {
  const r = parseExpenseSheet([header,
    ["L.", "Smith (fuel card)", "", "", 4, 4, "", A],
    ["Lynn", "Smith", "", "", "$1,006", 2, "", A.toUpperCase()],
  ], people);
  assert.deepEqual(r.rows, [{ employeeId: A, purchases: 1010, receipts: 6 }]);
  assert.equal(r.unmatched.length, 0);
});

test("falls back to the name (spacing and case ignored), including when the number is wrong", () => {
  const r = parseExpenseSheet([header,
    ["chad", "LINGAFELT", "", "", 3, 1, "", ""],
    ["Mary Ann", "Jones", "", "", 2, 2, "", "not-an-id"],
  ], people);
  assert.deepEqual(r.rows.map((x) => x.employeeId), [B, C]);
});

test("reports who couldn't be matched, skips blank and summary rows", () => {
  const r = parseExpenseSheet([header,
    ["Ghost", "Person", "", "", 5, 0, "", "99999999-9999-9999-9999-999999999999"],
    ["New", "Hire", "", "", 5, 0, "", ""],
    ["", "", "", "", 300, 250, "83%", ""],
    [],
    ["Lynn", "Smith", "", "", "N/A", 1, "", A],
  ], people);
  assert.deepEqual(r.unmatched.map((u) => u.name), ["Ghost Person", "New Hire", "Lynn Smith"]);
  assert.match(r.unmatched[0].reason, /Employee Number/);
  assert.match(r.unmatched[2].reason, /isn't a number/);
  assert.equal(r.rows.length, 0);
});

test("a sheet without the expected columns is an error, not an empty sync", () => {
  assert.throws(() => parseExpenseSheet([["Name", "Amount"], ["Lynn", 3]], people), /header row/);
});

test("sheetFrom keeps the tab from the link", () => {
  assert.deepEqual(sheetFrom("https://docs.google.com/spreadsheets/d/1T0VpaSv0cjmEWJAlNlUtNitWOrnZ-ZOmB7Pi9RKWGQQ/edit#gid=0"), { id: "1T0VpaSv0cjmEWJAlNlUtNitWOrnZ-ZOmB7Pi9RKWGQQ", gid: "0" });
  assert.deepEqual(sheetFrom("https://docs.google.com/spreadsheets/d/1T0VpaSv0cjmEWJAlNlUtNitWOrnZ-ZOmB7Pi9RKWGQQ/edit"), { id: "1T0VpaSv0cjmEWJAlNlUtNitWOrnZ-ZOmB7Pi9RKWGQQ", gid: null });
  assert.equal(sheetFrom("hello"), null);
});

test("automatic sync: due once from Tuesday 9am Eastern, and a Sync now after that counts", () => {
  const et = (s: string) => new Date(`${s}-04:00`); // October: Eastern daylight time
  assert.equal(autoSyncDue(null, et("2026-10-20T08:00")), true);                      // never synced
  assert.equal(autoSyncDue(et("2026-10-13T09:05"), et("2026-10-20T08:59")), false);   // Tue before 9: last week's still counts
  assert.equal(autoSyncDue(et("2026-10-13T09:05"), et("2026-10-20T09:00")), true);    // Tue 9:00: due
  assert.equal(autoSyncDue(et("2026-10-20T09:01"), et("2026-10-20T10:00")), false);   // just ran
  assert.equal(autoSyncDue(et("2026-10-20T08:30"), et("2026-10-20T10:00")), true);    // a Sync now before 9 doesn't count
  assert.equal(autoSyncDue(et("2026-10-21T15:00"), et("2026-10-25T12:00")), false);   // Wed sync, checked Sunday
  assert.equal(autoSyncDue(et("2026-10-19T15:00"), et("2026-10-19T16:00")), false);   // Monday: due point is last Tuesday
});
