// Scorecard rules, including Levi's 2026-10-16 changes (PTO forgiving, quarterly points, no 1:1 points).
import { test } from "node:test";
import assert from "node:assert/strict";
import { levelFor, monthComplete, quarterOf, scoreMonth, streak, weekdaysInMonth, type MonthInput } from "../server/lib/scoring";

// September 2026: Mondays 7, 14, 21, 28; Wednesdays 2, 9, 16, 23, 30. Scored as of mid-October (all weeks due).
const base = (over: Partial<MonthInput> = {}): MonthInput => ({
  month: "2026-09-01", currentMonday: "2026-10-12", currentAuditWeek: "2026-10-14",
  weeklyWeeks: new Set(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]),
  ptoWeeks: new Set(),
  audits: new Map(["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"].map((w) => [w, 100])),
  peerSubmitted: 2, peerReceivedAvg: 3.6, ...over,
});

test("weekday helpers", () => {
  assert.deepEqual(weekdaysInMonth("2026-09-01", 1), ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(weekdaysInMonth("2026-09-01", 3).length, 5);
});

test("everything done = perfect month, full participation", () => {
  const s = scoreMonth(base());
  assert.equal(s.participation, 3);
  assert.equal(s.overall, Math.round(((1 + 3.6 / 4 + 1) / 3) * 100));
  assert.equal(s.points, 100 + 90 + 100);
});

test("a missed cleanliness week counts as 0 in the average and breaks completion", () => {
  const audits = base().audits; audits.delete("2026-09-16");
  const s = scoreMonth(base({ audits }));
  assert.equal(s.items.cleanliness.done, false);
  assert.equal(s.cleanlinessAvg, 80);
});

test("PTO: that week's cleanliness and weekly report aren't owed, so nothing counts against them", () => {
  const audits = base().audits; audits.delete("2026-09-16");          // audit week opening Wed Sep 16…
  const weekly = base().weeklyWeeks; weekly.delete("2026-09-14");      // …and the weekly report for Mon Sep 14
  const s = scoreMonth(base({ audits, weeklyWeeks: weekly, ptoWeeks: new Set(["2026-09-14"]) }));
  assert.equal(s.items.cleanliness.done, true);
  assert.equal(s.items.cleanliness.owed, 4);
  assert.equal(s.cleanlinessAvg, 100);
  assert.equal(s.items.weeklyReport.done, true);
  assert.equal(s.items.weeklyReport.owed, 3);
});

test("PTO: a weekly report filed during PTO still counts (just not owed)", () => {
  const s = scoreMonth(base({ ptoWeeks: new Set(["2026-09-14"]) }));
  assert.equal(s.items.weeklyReport.done, true);
});

test("weeks that haven't finished yet aren't owed", () => {
  const s = scoreMonth(base({ month: "2026-10-01", weeklyWeeks: new Set(["2026-10-05"]), audits: new Map([["2026-10-07", 90]]), peerSubmitted: 1 }));
  assert.equal(s.items.weeklyReport.owed, 1); // Oct 5 only (Oct 12 is the current week)
  assert.equal(s.items.cleanliness.owed, 1);  // Oct 7 only (Oct 14 is the current audit week)
  assert.equal(s.participation, 3);
});

test("a fully-PTO month doesn't break the streak", () => {
  const allPto = new Set(weekdaysInMonth("2026-08-01", 1).concat(["2026-07-27"]));
  const aug = scoreMonth({ ...base(), month: "2026-08-01", weeklyWeeks: new Set(), audits: new Map(), peerSubmitted: 0, ptoWeeks: allPto });
  assert.equal(monthComplete(aug), "nothing-owed");
  const sep = scoreMonth(base());
  const jul = scoreMonth({ ...base(), month: "2026-07-01", weeklyWeeks: new Set(weekdaysInMonth("2026-07-01", 1)),
    audits: new Map(weekdaysInMonth("2026-07-01", 3).map((w) => [w, 100])) });
  assert.equal(streak([sep, aug, jul], "2026-10"), 2);
});

test("current month gets grace; an earlier incomplete month stops the streak", () => {
  const oct = scoreMonth(base({ month: "2026-10-01", weeklyWeeks: new Set(), audits: new Map(), peerSubmitted: 0 }));
  const sep = scoreMonth(base());
  const aug = scoreMonth(base({ month: "2026-08-01", weeklyWeeks: new Set(), audits: new Map() }));
  assert.equal(streak([oct, sep, aug], "2026-10"), 1);
});

test("quarters and levels", () => {
  assert.deepEqual(quarterOf("2026-10"), { label: "Q4 2026", months: ["2026-10", "2026-11", "2026-12"] });
  assert.equal(levelFor(0).name, "Rookie");
  assert.equal(levelFor(460).name, "Pro");
  assert.equal(levelFor(460).nextAt, 650);
  assert.equal(levelFor(900).name, "Legend");
});
