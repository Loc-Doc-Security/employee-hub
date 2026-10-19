// Date helpers for the Calendar: which birthdays and work anniversaries fall in a date range.
// Dates are plain YYYY-MM-DD strings (company-local calendar days).

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Every occurrence of a month-day (MM-DD) between from and to, inclusive. Feb 29 → Feb 28 in other years. */
export function occurrences(md: string, from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const day = md === "02-29" && !isLeap(y) ? "02-28" : md;
    const d = `${y}-${day}`;
    if (d >= from && d <= to) out.push(d);
  }
  return out;
}

/** Work anniversaries (1 year and up) between from and to. */
export function anniversaries(hiredOn: string, from: string, to: string): { date: string; years: number }[] {
  const hireYear = Number(hiredOn.slice(0, 4));
  return occurrences(hiredOn.slice(5, 10), from, to)
    .map((date) => ({ date, years: Number(date.slice(0, 4)) - hireYear }))
    .filter((a) => a.years >= 1);
}

/** Days from a to b (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v);

// The standard holiday list from the Wix Holidays page (Levi to confirm it's the right list).
// Each is placed on the day the office is closed: Saturday → the Friday before, Sunday → the Monday after.
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12)).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** The nth (1-based) given weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(y: number, m: number, dow: number, n: number): string {
  if (n === -1) {
    let d = addDays(ymd(y, m + 1, 1), -1); // last day of the month
    while (weekday(d) !== dow) d = addDays(d, -1);
    return d;
  }
  let d = ymd(y, m, 1);
  while (weekday(d) !== dow) d = addDays(d, 1);
  return addDays(d, 7 * (n - 1));
}

export function standardHolidays(year: number): { title: string; date: string; actual: string; moved: boolean }[] {
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const list = [
    { title: "New Year's Day", actual: ymd(year, 1, 1) },
    { title: "Memorial Day", actual: nthWeekday(year, 5, 1, -1) },
    { title: "Independence Day", actual: ymd(year, 7, 4) },
    { title: "Labor Day", actual: nthWeekday(year, 9, 1, 1) },
    { title: "Thanksgiving", actual: thanksgiving },
    { title: "Day after Thanksgiving", actual: addDays(thanksgiving, 1) },
    { title: "Christmas Eve", actual: ymd(year, 12, 24) },
    { title: "Christmas Day", actual: ymd(year, 12, 25) },
  ];
  return list.map(({ title, actual }) => {
    const dow = weekday(actual);
    const date = dow === 6 ? addDays(actual, -1) : dow === 0 ? addDays(actual, 1) : actual;
    return { title, date, actual, moved: date !== actual };
  });
}
