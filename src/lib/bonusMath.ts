// The bonus formula (Levi, 2026-08-26). Shared by the Bonus page (live recalculation while
// reviewing) and the server (which recalculates on save rather than trusting the page's numbers).
//
// The pool splits 50% Reliability / 35% Profitability / 15% Tenure. A person's share of each part
// = their score ÷ the sum of that score over everyone not excluded. Suggested bonus = Σ share ×
// that part of the pool; a confirmed payout is the suggested bonus rounded to the dollar.

export const SPLIT = { reliability: 0.5, profitability: 0.35, tenure: 0.15 } as const;
export const PROFITABILITY = { missed: 2, hit: 3, exceeded: 4 } as const;
export const DEFAULT_PROFITABILITY = 3;
export const RELIABILITY_WINDOW_DAYS = 190;

export type BonusStatus = "pending" | "confirmed" | "excluded";
export type BonusInput = { employeeId: string; reliability: number; tenure: number; profitability: number; status: BonusStatus };
export type BonusLine = BonusInput & {
  reliabilityShare: number; profitabilityShare: number; tenureShare: number; suggested: number; payout: number | null;
};

export function computeBonus(rows: BonusInput[], pool: number): BonusLine[] {
  const counted = rows.filter((r) => r.status !== "excluded");
  const sum = (k: "reliability" | "profitability" | "tenure") => counted.reduce((s, r) => s + r[k], 0);
  const totals = { reliability: sum("reliability"), profitability: sum("profitability"), tenure: sum("tenure") };
  const share = (r: BonusInput, k: keyof typeof totals) => (r.status === "excluded" || totals[k] <= 0 ? 0 : r[k] / totals[k]);
  return rows.map((r) => {
    const reliabilityShare = share(r, "reliability");
    const profitabilityShare = share(r, "profitability");
    const tenureShare = share(r, "tenure");
    const suggested = pool * (reliabilityShare * SPLIT.reliability + profitabilityShare * SPLIT.profitability + tenureShare * SPLIT.tenure);
    return {
      ...r, reliabilityShare, profitabilityShare, tenureShare, suggested,
      payout: r.status === "confirmed" ? Math.round(suggested) : r.status === "excluded" ? 0 : null,
    };
  });
}

/** Average each of the six criteria on its own, then average those six averages. */
export const CRITERIA = ["humble", "hungry", "smart", "helpful_kind", "fast_response", "solves_problems"] as const;
export type Criterion = (typeof CRITERIA)[number];
export function reliabilityOf(assessments: Record<Criterion, number>[]): { score: number | null; breakdown: Record<Criterion, number> | null } {
  if (!assessments.length) return { score: null, breakdown: null };
  const breakdown = Object.fromEntries(CRITERIA.map((c) => [c, assessments.reduce((s, a) => s + Number(a[c]), 0) / assessments.length])) as Record<Criterion, number>;
  return { score: CRITERIA.reduce((s, c) => s + breakdown[c], 0) / CRITERIA.length, breakdown };
}

/** Years since the hire date, to two decimals (365-day years, as the old app counted). */
export function tenureYears(hiredOn: string | null, today: Date): number | null {
  if (!hiredOn) return null;
  const start = new Date(`${hiredOn}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.round(((today.getTime() - start.getTime()) / (365 * 864e5)) * 100) / 100);
}
