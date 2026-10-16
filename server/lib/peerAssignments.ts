// Who an employee assesses in a given month (Levi, 2026-10-16):
//   everyone in their department(s) + 2 random teammates from outside it,
//   with extra random picks until the list reaches 5 (or the company runs out of people).
// The random picks are seeded by (assessor, month), so the same inputs always give the same list.
// The API stores the result the first time it's computed, so the list stays fixed for the month
// even if people join or leave.

export const RANDOM_PICKS = 2;
export const MIN_LIST = 5;

export type Pick = { subjectId: string; reason: "department" | "random" };

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * @param assessorId    the person doing the assessing (never picked)
 * @param departmentIds the assessor's departments
 * @param candidates    active employees in the same company: id + their department ids
 * @param month         YYYY-MM-01
 */
export function pickAssignments(
  assessorId: string,
  departmentIds: string[],
  candidates: { id: string; departmentIds: string[] }[],
  month: string,
): Pick[] {
  const others = candidates.filter((c) => c.id !== assessorId);
  const mine = new Set(departmentIds);
  const teammates = others.filter((c) => c.departmentIds.some((d) => mine.has(d)));
  const outside = others.filter((c) => !c.departmentIds.some((d) => mine.has(d)));

  const rand = seededRandom(`${assessorId}|${month}`);
  const shuffled = [...outside].sort((a, b) => a.id.localeCompare(b.id)); // stable base order
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const randomCount = Math.min(shuffled.length, Math.max(RANDOM_PICKS, MIN_LIST - teammates.length));

  return [
    ...teammates.map((t) => ({ subjectId: t.id, reason: "department" as const })),
    ...shuffled.slice(0, randomCount).map((t) => ({ subjectId: t.id, reason: "random" as const })),
  ];
}
