// Week math: Monday start, Eastern time, so late-Sunday submissions land in the right week.
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentWeekStart, mondayOf } from "../server/lib/weeks";

test("mondayOf snaps any day to its Monday", () => {
  assert.equal(mondayOf("2026-10-12"), "2026-10-12"); // Monday
  assert.equal(mondayOf("2026-10-13"), "2026-10-12"); // Tuesday (the old UTC-bug rows)
  assert.equal(mondayOf("2026-10-18"), "2026-10-12"); // Sunday belongs to the week before
});

test("current week uses Eastern time, not UTC", () => {
  // Sunday 2026-10-18 at 10pm Eastern = Monday 02:00 UTC. Still the week of Oct 12 for us.
  assert.equal(currentWeekStart(new Date("2026-10-19T02:00:00Z")), "2026-10-12");
  // Monday 2026-10-19 at 9am Eastern → new week.
  assert.equal(currentWeekStart(new Date("2026-10-19T13:00:00Z")), "2026-10-19");
});
