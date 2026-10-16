/**
 * Imports Wix TechSpotlights (company: Loc-Doc), without photos (Levi, 2026-10-16). Run after
 * import-employees and import-weekly-meetings.
 * The tech is matched by submitterEmail; rows with status "pending" (old test entries) or no
 * matching employee are skipped; the same tech twice on one date keeps the first. Rows with no
 * status are treated as submitted (Wix's own rule). Keeps Wix ids; safe to re-run.
 *
 * Usage: npx tsx scripts/migration/import-tech-spotlights.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const stamp = (v: unknown) => (v && typeof v === "object" && "$date" in v ? (v as { $date: string }).$date : null);

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows: Row[] = JSON.parse(await readFile(path.join(exportDir, "collections", "TechSpotlights.json"), "utf8"));
  rows.sort((a, b) => String(stamp(a._createdDate)).localeCompare(String(stamp(b._createdDate))));
  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { read: rows.length, imported: 0, linkedToMeeting: 0, skippedPending: 0, skippedNoEmployee: 0, skippedDuplicate: 0 };
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const byEmail = new Map((await db.query("SELECT id, lower(email) AS email FROM employees")).rows.map((r) => [r.email as string, r.id as string]));
    const meetings = new Map((await db.query("SELECT id, meeting_on::text AS d FROM weekly_meetings WHERE company_id = $1", [company.id])).rows.map((r) => [r.d as string, r.id as string]));
    const seen = new Set<string>();

    for (const r of rows) {
      if (text(r.status) === "pending") { n.skippedPending++; continue; }
      const employeeId = byEmail.get(text(r.submitterEmail).toLowerCase());
      if (!employeeId) { n.skippedNoEmployee++; continue; }
      const date = text(r.spotlightDate).slice(0, 10);
      if (seen.has(`${employeeId}|${date}`)) { n.skippedDuplicate++; continue; }
      seen.add(`${employeeId}|${date}`);
      const meetingId = meetings.get(date) ?? null;
      if (meetingId) n.linkedToMeeting++;
      const status = text(r.status) === "draft" ? "draft" : "submitted";
      const slides = text(r.slidesUrl).startsWith("https://") ? text(r.slidesUrl) : null;
      const enteredBy = text(r.submittedBy) ? byEmail.get(text(r.submittedBy).toLowerCase()) ?? null : null;
      const created = stamp(r._createdDate) ?? `${date}T12:00:00Z`;
      await db.query(
        `INSERT INTO tech_spotlights (id, company_id, employee_id, presented_on, meeting_id, title, problem, solution,
           slides_url, photos, status, submitted_at, entered_by_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]',$10,$11,$12,$13,$13)
         ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, presented_on = EXCLUDED.presented_on,
           meeting_id = EXCLUDED.meeting_id, title = EXCLUDED.title, problem = EXCLUDED.problem, solution = EXCLUDED.solution,
           slides_url = EXCLUDED.slides_url, status = EXCLUDED.status, submitted_at = EXCLUDED.submitted_at,
           entered_by_id = EXCLUDED.entered_by_id`,
        [r._id, company.id, employeeId, date, meetingId, text(r.title), text(r.problem), text(r.solution), slides,
         status, status === "submitted" ? stamp(r.submittedDate) ?? created : null, enteredBy, created],
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
  console.log(`  read ${n.read}, imported ${n.imported} (${n.linkedToMeeting} linked to a meeting)`);
  console.log(`  skipped: ${n.skippedPending} pending test rows, ${n.skippedNoEmployee} with no matching employee, ${n.skippedDuplicate} duplicates`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
