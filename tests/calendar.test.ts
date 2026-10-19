import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, anniversaries, daysBetween, isDate, occurrences, standardHolidays } from "../server/lib/calendar";

test("birthdays in a range, including across the new year", () => {
  assert.deepEqual(occurrences("10-31", "2026-10-01", "2026-10-31"), ["2026-10-31"]);
  assert.deepEqual(occurrences("01-02", "2026-12-15", "2027-01-15"), ["2027-01-02"]);
  assert.deepEqual(occurrences("06-01", "2026-10-01", "2026-12-31"), []);
});

test("Feb 29 birthdays show on Feb 28 outside leap years", () => {
  assert.deepEqual(occurrences("02-29", "2027-02-01", "2027-03-01"), ["2027-02-28"]);
  assert.deepEqual(occurrences("02-29", "2028-02-01", "2028-03-01"), ["2028-02-29"]);
});

test("work anniversaries count years and skip the hire year itself", () => {
  assert.deepEqual(anniversaries("2023-10-20", "2026-10-01", "2026-10-31"), [{ date: "2026-10-20", years: 3 }]);
  assert.deepEqual(anniversaries("2026-10-05", "2026-10-01", "2026-10-31"), []);
});

test("date helpers", () => {
  assert.equal(daysBetween("2026-10-01", "2026-12-31"), 91);
  assert.equal(addDays("2026-12-30", 4), "2027-01-03");
  assert.ok(isDate("2026-02-28"));
  assert.ok(!isDate("2026-02-30"));
  assert.ok(!isDate("2026-1-5"));
  assert.ok(!isDate(undefined));
});

test("standard holidays land on the office-closed day", () => {
  const h = Object.fromEntries(standardHolidays(2026).map((x) => [x.title, x]));
  assert.equal(h["Memorial Day"].date, "2026-05-25");
  assert.equal(h["Labor Day"].date, "2026-09-07");
  assert.equal(h["Thanksgiving"].date, "2026-11-26");
  assert.equal(h["Day after Thanksgiving"].date, "2026-11-27");
  assert.equal(h["Independence Day"].actual, "2026-07-04"); // a Saturday
  assert.equal(h["Independence Day"].date, "2026-07-03");   // closed Friday
  assert.ok(h["Independence Day"].moved);
  const h27 = Object.fromEntries(standardHolidays(2027).map((x) => [x.title, x]));
  assert.equal(h27["Christmas Day"].date, "2027-12-24");    // Sat → Fri
  assert.equal(h27["Christmas Eve"].date, "2027-12-24");    // Fri itself
  assert.equal(h27["New Year's Day"].date, "2027-01-01");
  assert.equal(standardHolidays(2028).find((x) => x.title === "Memorial Day")!.date, "2028-05-29");
});
