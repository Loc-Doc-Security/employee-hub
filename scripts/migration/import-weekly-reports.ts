/**
 * Imports Wix WeeklyReport history into weekly_reports (company: Loc-Doc). Run after import-employees.
 *
 * Matching a report to a person: Wix employeeId → employee email → otherwise a "former employee"
 * snapshot (name + email, employee_id NULL). The Employees collection was rebuilt in 2026, so
 * almost all 2021–2025 reports only match by email.
 *
 * Clean-up, all counted in the report, never silent:
 *   - weekStart not on a Monday (a few Tuesdays from a UTC rounding bug) → moved to that week's Monday
 *   - decimal scores (older slider form) → rounded; blank scores → skipped
 *   - two reports for one person in one week → the FIRST submitted is kept (no-edit rule)
 *
 * Keeps each Wix _id as the row id; safe to re-run (upsert). One transaction.
 * Usage: npx tsx scripts/migration/import-weekly-reports.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";
import { mondayOf } from "../../server/lib/weeks";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const created = (r: Row) => {
  const c = r._createdDate as { $date?: string } | string | undefined;
  return (typeof c === "object" && c?.$date) || (typeof c === "string" ? c : "") || `${text(r.submittedDate) || text(r.weekStart)}T12:00:00Z`;
};

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows: Row[] = JSON.parse(await readFile(path.join(exportDir, "collections", "WeeklyReport.json"), "utf8"));
  rows.sort((a, b) => created(a).localeCompare(created(b))); // earliest first, so the first submission wins

  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { read: rows.length, imported: 0, byId: 0, byEmail: 0, former: 0, movedToMonday: 0, rounded: 0,
    skippedBlankScores: 0, skippedNoPerson: 0, skippedDuplicateWeek: 0 };
  const formerPeople = new Set<string>();

  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const emps = (await db.query("SELECT id, lower(email) AS email FROM employees")).rows as { id: string; email: string }[];
    const ids = new Set(emps.map((e) => e.id));
    const byEmail = new Map(emps.map((e) => [e.email, e.id]));

    const seen = new Set<string>();
    for (const r of rows) {
      const scores = [r.stressLevel, r.morale, r.workload].map((v) => (v === null || v === undefined || v === "" ? NaN : Number(v)));
      if (scores.some((s) => !Number.isFinite(s))) { n.skippedBlankScores++; continue; }
      const rounded = scores.map((s) => Math.min(5, Math.max(1, Math.round(s))));
      if (rounded.some((s, i) => s !== scores[i])) n.rounded++;

      const email = text(r.email).toLowerCase();
      let employeeId: string | null = null;
      if (ids.has(text(r.employeeId))) { employeeId = text(r.employeeId); n.byId++; }
      else if (email && byEmail.has(email)) { employeeId = byEmail.get(email)!; n.byEmail++; }
      const formerName = employeeId ? null : text(r.submitterName) || null;
      const formerEmail = employeeId ? null : email || null;
      if (!employeeId && !formerName && !formerEmail) { n.skippedNoPerson++; continue; }

      const raw = text(r.weekStart);
      const week = mondayOf(raw);
      if (week !== raw) n.movedToMonday++;

      const who = employeeId ?? `former:${formerEmail ?? formerName}`;
      if (seen.has(`${who}|${week}`)) { n.skippedDuplicateWeek++; continue; }
      seen.add(`${who}|${week}`);
      if (!employeeId) { n.former++; formerPeople.add(formerEmail ?? formerName!); }

      await db.query(
        `INSERT INTO weekly_reports (id, company_id, employee_id, former_name, former_email, week_start,
           stress_level, morale, workload, week_high, week_low, additional_notes, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, former_name = EXCLUDED.former_name,
           former_email = EXCLUDED.former_email, week_start = EXCLUDED.week_start,
           stress_level = EXCLUDED.stress_level, morale = EXCLUDED.morale, workload = EXCLUDED.workload,
           week_high = EXCLUDED.week_high, week_low = EXCLUDED.week_low,
           additional_notes = EXCLUDED.additional_notes, submitted_at = EXCLUDED.submitted_at`,
        [r._id, company.id, employeeId, formerName, formerEmail, week, ...rounded,
         text(r.weekHigh), text(r.weekLow), text(r.additionalNotes), created(r)],
      );
      n.imported++;
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }

  console.log(`Imported from ${exportDir}`);
  console.log(`  read ${n.read}, imported ${n.imported}`);
  console.log(`  matched: ${n.byId} by Wix id, ${n.byEmail} by email; ${n.former} from ${formerPeople.size} former employees (name/email kept)`);
  console.log(`  adjusted: ${n.movedToMonday} moved to their Monday, ${n.rounded} with decimal scores rounded`);
  console.log(`  skipped: ${n.skippedBlankScores} blank scores, ${n.skippedDuplicateWeek} duplicate weeks (first kept), ${n.skippedNoPerson} no person`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
