// Scorecard math. Pure (no database), ported from the Wix scoring-core with Levi's 2026-10-16 changes:
//   - PTO is forgiving: a PTO week is never owed (weekly report, cleanliness), so it can't count
//     against the score or break a streak. A weekly report filed during PTO still counts.
//   - Points add up per QUARTER (a fresh start each quarter) and set the level.
//   - No points for 1:1s (stays a manager checklist item, outside the employee's score).
//
// Each month an employee owes: a weekly report every (non-PTO) week, at least one peer assessment,
// and a cleanliness audit every (non-PTO) audit week, counting only weeks that are already over.
// Overall score = average of participation (0, ⅓, ⅔, 1), peer quality (avg / 4) and cleanliness
// quality (avg %, a missed owed week counts as 0); a quality with no data yet is left out.

export const LEVELS = [
  { level: 1, min: 0, name: "Rookie" },
  { level: 2, min: 200, name: "Steady" },
  { level: 3, min: 450, name: "Pro" },
  { level: 4, min: 650, name: "Elite" },
  { level: 5, min: 800, name: "Legend" },
];

export type MonthInput = {
  month: string;              // YYYY-MM-01
  currentMonday: string;      // this week's Monday (weeks starting on/after it aren't due yet)
  currentAuditWeek: string;   // this audit week's Wednesday
  weeklyWeeks: Set<string>;   // Mondays with a weekly report
  ptoWeeks: Set<string>;      // Mondays marked PTO
  audits: Map<string, number>; // audit Wednesday → score
  peerSubmitted: number;      // assessments this person gave this month
  peerReceivedAvg: number | null; // average of all six criteria received this month (1–4)
};

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every date in the month that falls on the given weekday (1 = Monday, 3 = Wednesday). */
export function weekdaysInMonth(month: string, isoWeekday: number): string[] {
  const out: string[] = [];
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  const m = d.getUTCMonth();
  while (d.getUTCMonth() === m) {
    if (((d.getUTCDay() + 6) % 7) + 1 === isoWeekday) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function scoreMonth(i: MonthInput) {
  const weeklyOwed = weekdaysInMonth(i.month, 1).filter((w) => w < i.currentMonday && !i.ptoWeeks.has(w));
  const weeklyDone = weeklyOwed.filter((w) => i.weeklyWeeks.has(w)).length;
  const auditOwed = weekdaysInMonth(i.month, 3).filter((w) => w < i.currentAuditWeek && !i.ptoWeeks.has(addDays(w, -2)));
  const auditDone = auditOwed.filter((w) => i.audits.has(w)).length;

  const wOk = weeklyOwed.length > 0 && weeklyDone >= weeklyOwed.length;
  const aOk = i.peerSubmitted > 0;
  const cOk = auditOwed.length > 0 && auditDone >= auditOwed.length;
  const participation = (wOk ? 1 : 0) + (aOk ? 1 : 0) + (cOk ? 1 : 0);
  const partFrac = participation / 3;

  const peerFrac = i.peerReceivedAvg != null ? i.peerReceivedAvg / 4 : null;
  const cleanAvg = auditOwed.length ? auditOwed.reduce((s, w) => s + (i.audits.get(w) ?? 0), 0) / auditOwed.length : null;
  const cleanFrac = cleanAvg != null ? cleanAvg / 100 : null;

  const parts = [partFrac, ...(peerFrac != null ? [peerFrac] : []), ...(cleanFrac != null ? [cleanFrac] : [])];
  const overall = Math.round((parts.reduce((s, x) => s + x, 0) / parts.length) * 100);
  const points = Math.round(100 * partFrac) + (peerFrac != null ? Math.round(100 * peerFrac) : 0) + (cleanAvg != null ? Math.round(cleanAvg) : 0);

  return {
    month: i.month.slice(0, 7),
    overall,
    points,
    participation,
    items: {
      weeklyReport: { done: wOk, count: weeklyDone, owed: weeklyOwed.length },
      peerAssessment: { done: aOk, count: i.peerSubmitted },
      cleanliness: { done: cOk, count: auditDone, owed: auditOwed.length },
    },
    peerReceivedAvg: i.peerReceivedAvg,
    cleanlinessAvg: cleanAvg != null ? Math.round(cleanAvg) : null,
    ptoWeeks: weekdaysInMonth(i.month, 1).filter((w) => i.ptoWeeks.has(w)),
  };
}

export type MonthScore = ReturnType<typeof scoreMonth>;

/** A month counts toward the streak when everything owed was done. A month where PTO covered
 * every owed week (nothing owed) doesn't break it. */
export function monthComplete(s: MonthScore): boolean | "nothing-owed" {
  const { weeklyReport: w, cleanliness: c, peerAssessment: a } = s.items;
  if (w.owed === 0 && c.owed === 0) return "nothing-owed";
  return (w.owed === 0 || w.done) && (c.owed === 0 || c.done) && a.done;
}

/** Consecutive complete months ending at the latest; the in-progress current month gets grace. */
export function streak(monthsNewestFirst: MonthScore[], currentMonth: string): number {
  let n = 0;
  for (const [i, m] of monthsNewestFirst.entries()) {
    const c = monthComplete(m);
    if (c === true) { n++; continue; }
    if (c === "nothing-owed") continue;
    if (i === 0 && m.month === currentMonth) continue;
    break;
  }
  return n;
}

export function quarterOf(month: string) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const q = Math.floor((m - 1) / 3);
  return { label: `Q${q + 1} ${y}`, months: [1, 2, 3].map((k) => `${y}-${String(q * 3 + k).padStart(2, "0")}`) };
}

export function levelFor(points: number) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) cur = l;
  const next = LEVELS.find((l) => l.min > points) ?? null;
  return { ...cur, nextAt: next?.min ?? null, nextName: next?.name ?? null };
}

export function badgesFor(s: MonthScore, streakMonths: number) {
  const b: { key: string; label: string; emoji: string }[] = [];
  if (s.participation === 3) b.push({ key: "perfectMonth", label: "Perfect Month", emoji: "🏆" });
  if (streakMonths >= 3) b.push({ key: "streak", label: `${streakMonths}-Month Streak`, emoji: "🔥" });
  if (s.peerReceivedAvg != null && s.peerReceivedAvg >= 3.5) b.push({ key: "topPeer", label: "Top Peer Score", emoji: "⭐" });
  return b;
}
