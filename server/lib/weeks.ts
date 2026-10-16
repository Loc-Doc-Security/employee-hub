// Week math for weekly features. A week starts Monday, in the company's time zone (Eastern for
// Loc-Doc), so a report submitted late Sunday night still lands in the right week.
export const COMPANY_TIME_ZONE = "America/New_York";

/** YYYY-MM-DD of the calendar date at `when` in the given time zone. */
export function localDate(when: Date, timeZone = COMPANY_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

/** Monday (YYYY-MM-DD) of the week containing a YYYY-MM-DD date. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/** Monday of the current week in the company's time zone. */
export function currentWeekStart(now = new Date(), timeZone = COMPANY_TIME_ZONE): string {
  return mondayOf(localDate(now, timeZone));
}
