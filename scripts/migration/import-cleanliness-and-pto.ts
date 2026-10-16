/**
 * Imports Wix CleanlinessAudit + PTO history (company: Loc-Doc). Run after import-employees.
 *
 * Audits: matched by Wix employeeId, then email. Photos are NOT imported (Levi, 2026-10-16), but
 * each audit keeps the score it was given at the time, which counted those photos. Old leftover
 * PTO-as-audit rows (isPTO) are skipped; PTO comes from the PTO collection.
 * PTO: each Wix row is a cleanliness week (Wednesday) → stored as its work week (the Monday before).
 * The marker is matched to an employee by name when possible; otherwise the name is kept as text.
 *
 * Keeps Wix ids; safe to re-run. One transaction.
 * Usage: npx tsx scripts/migration/import-cleanliness-and-pto.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";
import { ptoWeekForAuditWeek } from "../../server/lib/weeks";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const stamp = (v: unknown) => (v && typeof v === "object" && "$date" in v ? (v as { $date: string }).$date : text(v) || null);
const pct = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.max(0, Math.min(100, Math.round(Number(v)))));

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const read = async (name: string): Promise<Row[]> =>
    JSON.parse(await readFile(path.join(exportDir, "collections", `${name}.json`), "utf8"));
  const audits = await read("CleanlinessAudit");
  const pto = await read("PTO");

  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { audits: 0, auditsByEmail: 0, skippedLegacyPto: 0, skippedNoPerson: 0, skippedNotWednesday: 0,
    pto: 0, ptoMarkerByName: 0, ptoMarkerKeptAsText: 0, ptoSkipped: 0 };
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const emps = (await db.query("SELECT id, lower(email) AS email, lower(first_name || ' ' || last_name) AS name FROM employees")).rows;
    const ids = new Set(emps.map((e) => e.id as string));
    const byEmail = new Map(emps.map((e) => [e.email as string, e.id as string]));
    const byName = new Map(emps.map((e) => [e.name as string, e.id as string]));

    for (const r of audits) {
      if (r.isPTO === true) { n.skippedLegacyPto++; continue; }
      let employeeId = ids.has(text(r.employeeId)) ? text(r.employeeId) : null;
      if (!employeeId && byEmail.has(text(r.email).toLowerCase())) { employeeId = byEmail.get(text(r.email).toLowerCase())!; n.auditsByEmail++; }
      if (!employeeId) { n.skippedNoPerson++; continue; }
      const week = text(r.weekStart);
      if (new Date(`${week}T12:00:00Z`).getUTCDay() !== 3) { n.skippedNotWednesday++; continue; }
      const answers = typeof r.answers === "string" ? JSON.parse(r.answers) : r.answers ?? {};
      const submitted = stamp(r._createdDate) ?? `${text(r.submittedDate) || week}T12:00:00Z`;
      await db.query(
        `INSERT INTO cleanliness_audits (id, company_id, employee_id, week_start, has_vehicle, has_office, vehicle_number,
           answers, photos, pass_count, total_count, score, vehicle_score, office_score, submitted_by_id,
           submitted_at, edit_count, last_edited_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}',$9,$10,$11,$12,$13,$3,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, week_start = EXCLUDED.week_start,
           has_vehicle = EXCLUDED.has_vehicle, has_office = EXCLUDED.has_office, vehicle_number = EXCLUDED.vehicle_number,
           answers = EXCLUDED.answers, pass_count = EXCLUDED.pass_count, total_count = EXCLUDED.total_count,
           score = EXCLUDED.score, vehicle_score = EXCLUDED.vehicle_score, office_score = EXCLUDED.office_score,
           submitted_at = EXCLUDED.submitted_at, edit_count = EXCLUDED.edit_count, last_edited_at = EXCLUDED.last_edited_at`,
        [r._id, company.id, employeeId, week, r.hasVehicle === true, r.hasOffice === true, text(r.vehicleNumber) || null,
         JSON.stringify(answers), Number(r.passCount) || 0, Number(r.totalCount) || 0, pct(r.score) ?? 0,
         pct(r.vehicleScore), pct(r.officeScore), submitted, Number(r.editCount) || 0, stamp(r.lastEditedDate)],
      );
      n.audits++;
    }

    for (const p of pto) {
      const employeeId = text(p.EmployeeID);
      const week = text(p.weekStart);
      if (!ids.has(employeeId) || !week) { n.ptoSkipped++; continue; }
      const markerName = text(p.markedByName);
      const markerId = byName.get(markerName.toLowerCase()) ?? null;
      if (markerId) n.ptoMarkerByName++; else n.ptoMarkerKeptAsText++;
      await db.query(
        `INSERT INTO pto_weeks (id, company_id, employee_id, week_start, marked_by_id, marked_by_name, marked_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'wix_import')
         ON CONFLICT (id) DO UPDATE SET week_start = EXCLUDED.week_start, marked_by_id = EXCLUDED.marked_by_id,
           marked_by_name = EXCLUDED.marked_by_name, marked_at = EXCLUDED.marked_at`,
        [p._id, company.id, employeeId, ptoWeekForAuditWeek(week), markerId, markerId ? null : markerName || null,
         stamp(p._createdDate) ?? new Date().toISOString()],
      );
      n.pto++;
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
  console.log(`Imported from ${exportDir}`);
  console.log(`  audits: ${n.audits} (${n.auditsByEmail} matched by email); skipped ${n.skippedLegacyPto} old PTO-as-audit rows, ${n.skippedNoPerson} with no matching person, ${n.skippedNotWednesday} not on a Wednesday`);
  console.log(`  PTO weeks: ${n.pto} (marker matched for ${n.ptoMarkerByName}, kept as text for ${n.ptoMarkerKeptAsText}); skipped ${n.ptoSkipped}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
