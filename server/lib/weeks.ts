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

/** First day (YYYY-MM-01) of the current month in the company's time zone. */
export function currentMonthStart(now = new Date(), timeZone = COMPANY_TIME_ZONE): string {
  return `${localDate(now, timeZone).slice(0, 7)}-01`;
}

// --- Cleanliness audit weeks -------------------------------------------------------------------
// An audit week opens Wednesday 9:00am (Eastern) and runs through the following Tuesday night.
// Wednesday 00:00–09:00 is locked for the meeting; during the lock the "current" week is the one
// that just closed (the one under review).

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Hour (0–23) at `when` in the company's time zone. */
function localHour(when: Date, timeZone = COMPANY_TIME_ZONE): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(when));
}

/** Wednesday (YYYY-MM-DD) that opened the audit week in effect at `now`. */
export function auditWeekStart(now = new Date(), timeZone = COMPANY_TIME_ZONE): string {
  const today = localDate(now, timeZone);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday … 3 = Wednesday
  let back = (dow + 4) % 7; // days since the most recent Wednesday
  if (back === 0 && localHour(now, timeZone) < 9) back = 7;
  return addDays(today, -back);
}

/** True during the Wednesday 00:00–09:00 meeting lock. */
export function isAuditLocked(now = new Date(), timeZone = COMPANY_TIME_ZONE): boolean {
  const dow = new Date(`${localDate(now, timeZone)}T12:00:00Z`).getUTCDay();
  return dow === 3 && localHour(now, timeZone) < 9;
}

/** PTO is stored by work week (Monday); the audit week opening that Wednesday is the exempt one. */
export const ptoWeekForAuditWeek = (auditWednesday: string) => addDays(auditWednesday, -2);
export const auditWeekForPtoWeek = (ptoMonday: string) => addDays(ptoMonday, 2);
