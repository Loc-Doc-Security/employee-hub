// Reads accounting's "28 Day Rolling Data" sheet into one row per employee. Same rules the n8n
// workflow used: match by the Employee Number column (the employee's id) first, then by first + last
// name; several cards for one person are added together; rows without a name (the sheet's summary
// rows) are ignored; anything that can't be matched is reported, never silently dropped.
import type { SyncRow } from "./expenseIngest";
import { COMPANY_TIME_ZONE, localDate, mondayOf } from "./weeks";

export type SheetEmployee = { id: string; firstName: string; lastName: string };
export type Unmatched = { name: string; reason: string };

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

export function parseExpenseSheet(values: unknown[][], employees: SheetEmployee[]): { rows: SyncRow[]; unmatched: Unmatched[] } {
  const headerAt = values.findIndex((row) => row.some((c) => norm(c) === "first name") && row.some((c) => norm(c) === "total purchases"));
  if (headerAt < 0) throw new Error('Couldn\'t find the header row (needs "First Name" and "Total Purchases" columns).');
  const header = values[headerAt].map(norm);
  const col = (name: string) => header.indexOf(name);
  const c = { first: col("first name"), last: col("last name"), purchases: col("total purchases"), receipts: col("receipts uploaded"), id: col("employee number") };
  if (c.receipts < 0) throw new Error('The sheet has no "Receipts Uploaded" column.');

  const byId = new Map(employees.map((e) => [e.id.toLowerCase(), e]));
  const byName = new Map(employees.map((e) => [norm(`${e.firstName} ${e.lastName}`), e]));
  const totals = new Map<string, SyncRow>();
  const unmatched: Unmatched[] = [];

  for (const row of values.slice(headerAt + 1)) {
    const first = String(row[c.first] ?? "").trim();
    const last = c.last >= 0 ? String(row[c.last] ?? "").trim() : "";
    if (!first && !last) continue;
    const name = `${first} ${last}`.trim();
    const idRaw = c.id >= 0 ? String(row[c.id] ?? "").trim().toLowerCase() : "";
    const emp = (idRaw && byId.get(idRaw)) || byName.get(norm(name));
    if (!emp) {
      unmatched.push({ name, reason: idRaw ? `Employee Number ${idRaw} isn't anyone in the hub, and neither is the name.` : "No Employee Number, and the name doesn't match anyone in the hub." });
      continue;
    }
    const purchases = num(row[c.purchases] || 0);
    const receipts = num(row[c.receipts] || 0);
    if (!Number.isFinite(purchases) || !Number.isFinite(receipts) || purchases < 0 || receipts < 0) {
      unmatched.push({ name, reason: "Purchases or receipts isn't a number." });
      continue;
    }
    const t = totals.get(emp.id) ?? { employeeId: emp.id, purchases: 0, receipts: 0 };
    t.purchases += Math.round(purchases);
    t.receipts += Math.round(receipts);
    totals.set(emp.id, t);
  }
  return { rows: [...totals.values()], unmatched };
}

/** Accepts a Sheet link (keeps its tab) or a bare id. */
export function sheetFrom(input: string): { id: string; gid: string | null } | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return { id: m[1], gid: s.match(/[#&?]gid=(\d+)/)?.[1] ?? null };
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? { id: s, gid: null } : null;
}

const etStamp = (d: Date) => `${localDate(d)} ${new Intl.DateTimeFormat("en-US", { timeZone: COMPANY_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(d)}`;

/**
 * The automatic sync runs once a week, Tuesday 9am Eastern (when n8n used to). Due if nothing has
 * synced since the most recent Tuesday 9am; a "Sync now" after that time counts as this week's.
 */
export function autoSyncDue(lastSynced: Date | null, now = new Date()): boolean {
  const today = localDate(now);
  const tue = new Date(`${mondayOf(today)}T12:00:00Z`);
  tue.setUTCDate(tue.getUTCDate() + 1);
  const due = `${tue.toISOString().slice(0, 10)} 09`;
  const nowStamp = etStamp(now);
  const latestDue = nowStamp >= due ? due : `${new Date(tue.getTime() - 7 * 864e5).toISOString().slice(0, 10)} 09`;
  return !lastSynced || etStamp(lastSynced) < latestDue;
}
