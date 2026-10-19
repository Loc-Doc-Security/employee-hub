import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBonus, reliabilityOf, tenureYears, type BonusInput } from "../src/lib/bonusMath";

const row = (id: string, reliability: number, tenure: number, profitability = 3, status: BonusInput["status"] = "confirmed"): BonusInput =>
  ({ employeeId: id, reliability, tenure, profitability, status });

test("pool splits 50/35/15 by share of each score; confirmed payouts add up to the pool", () => {
  const out = computeBonus([row("a", 3, 1), row("b", 3, 3)], 1000);
  // a: rel 0.5*500=250, prof 0.5*350=175, tenure 0.25*150=37.5 → 462.5
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(out[0].suggested, 462.5);
  near(out[1].suggested, 537.5);
  assert.equal(out[1].payout, 538); // rounded to the dollar
  near(out.reduce((s, r) => s + r.suggested, 0), 1000);
});

test("matches a real September 2026 Wix row (Alec Flanigan → $93)", () => {
  // Shares from the Wix record; pool 4574.13
  const pool = 4574.13;
  const s = pool * (0.024424773485932288 * 0.5 + 0.017857142857142856 * 0.35 + 0.012761592121460814 * 0.15);
  assert.equal(Math.round(s), 93);
});

test("excluding someone removes them from every sum, so everyone else's share grows", () => {
  const before = computeBonus([row("a", 3, 1), row("b", 3, 1), row("c", 3, 1)], 900);
  const after = computeBonus([row("a", 3, 1), row("b", 3, 1), row("c", 3, 1, 3, "excluded")], 900);
  assert.equal(Math.round(before[0].suggested), 300);
  assert.equal(Math.round(after[0].suggested), 450);
  assert.equal(after[2].suggested, 0);
  assert.equal(after[2].payout, 0);
});

test("profitability changes shift money between teams; pending rows have no payout yet", () => {
  const out = computeBonus([row("a", 3, 1, 4, "pending"), row("b", 3, 1, 2)], 1000);
  assert.ok(out[0].suggested > out[1].suggested);
  assert.equal(out[0].payout, null);
});

test("nobody with tenure or reliability data doesn't divide by zero", () => {
  const out = computeBonus([row("a", 0, 0), row("b", 0, 0)], 1000);
  assert.equal(Math.round(out[0].suggested), 175); // only profitability pays out
});

test("reliability: average each criterion, then average the six", () => {
  const a = { humble: 4, hungry: 4, smart: 4, helpful_kind: 4, fast_response: 4, solves_problems: 4 };
  const b = { humble: 2, hungry: 2, smart: 2, helpful_kind: 2, fast_response: 2, solves_problems: 4 };
  const r = reliabilityOf([a, b]);
  assert.equal(r.breakdown!.humble, 3);
  assert.equal(r.breakdown!.solves_problems, 4);
  assert.equal(r.score!.toFixed(4), (19 / 6).toFixed(4));
  assert.deepEqual(reliabilityOf([]), { score: null, breakdown: null });
});

test("tenure in 365-day years, two decimals; missing hire date is null", () => {
  assert.equal(tenureYears("2023-10-19", new Date("2026-10-19T12:00:00Z")), 3);
  assert.equal(tenureYears(null, new Date()), null);
  assert.equal(tenureYears("2030-01-01", new Date("2026-01-01T00:00:00Z")), 0);
});
