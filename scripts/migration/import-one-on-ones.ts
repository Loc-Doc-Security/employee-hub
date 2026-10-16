/**
 * Imports Wix OneOnOne history into one_on_ones (company: Loc-Doc). Run after import-employees.
 * Employee and manager are matched by Wix id; a manager no longer in the employee list keeps their
 * name as text. Rows whose employee can't be matched are skipped (counted). Keeps Wix ids; safe to
 * re-run. One transaction.
 *
 * Usage: npx tsx scripts/migration/import-one-on-ones.ts [path/to/wix-export/<timestamp>]
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
  const rows: Row[] = JSON.parse(await readFile(path.join(exportDir, "collections", "OneOnOne.json"), "utf8"));
  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { read: rows.length, imported: 0, managerKeptAsName: 0, skippedNoEmployee: 0, skippedNoDate: 0 };
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const ids = new Set((await db.query("SELECT id FROM employees")).rows.map((r) => r.id as string));

    for (const r of rows) {
      const employeeId = text(r.employeeId);
      if (!ids.has(employeeId)) { n.skippedNoEmployee++; continue; }
      const metOn = text(r.meetingDate).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(metOn)) { n.skippedNoDate++; continue; }
      const managerId = ids.has(text(r.managerId)) ? text(r.managerId) : null;
      if (!managerId) n.managerKeptAsName++;
      const visits = Array.isArray(r.siteVisits) ? r.siteVisits.map((v) => ({ label: text((v as Row).label), notes: text((v as Row).notes) })) : [];
      await db.query(
        `INSERT INTO one_on_ones (id, company_id, employee_id, manager_id, manager_former_name, met_on, month,
           areas_of_improvement, whats_going_well, whats_not_going_well, needs, how_can_i_help, site_visits, follow_ups, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, manager_id = EXCLUDED.manager_id,
           manager_former_name = EXCLUDED.manager_former_name, met_on = EXCLUDED.met_on, month = EXCLUDED.month,
           areas_of_improvement = EXCLUDED.areas_of_improvement, whats_going_well = EXCLUDED.whats_going_well,
           whats_not_going_well = EXCLUDED.whats_not_going_well, needs = EXCLUDED.needs,
           how_can_i_help = EXCLUDED.how_can_i_help, site_visits = EXCLUDED.site_visits, follow_ups = EXCLUDED.follow_ups`,
        [r._id, company.id, employeeId, managerId, managerId ? null : text(r.managerName) || "Unknown manager",
         metOn, `${metOn.slice(0, 7)}-01`, text(r.areasOfImprovement), text(r.whatsGoingWell), text(r.whatsNotGoingWell),
         text(r.needs), text(r.howCanIHelp), JSON.stringify(visits), text(r.followUps),
         stamp(r._createdDate) ?? `${metOn}T12:00:00Z`],
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
  console.log(`  read ${n.read}, imported ${n.imported} (manager kept as name: ${n.managerKeptAsName}); skipped ${n.skippedNoEmployee} with unknown employee, ${n.skippedNoDate} with no date`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
