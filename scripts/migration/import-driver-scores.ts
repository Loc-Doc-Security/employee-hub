/**
 * Imports Wix DriverScores (company: Loc-Doc), one report per Geotab week. Run after
 * import-employees. Keeps each row's Wix id and stored parked state; the week's fleet score is the
 * value stamped on its rows (fleetScoreReported). Employee links are kept only when that employee
 * exists. Safe to re-run: each imported week is rebuilt.
 *
 * Usage: npx tsx scripts/migration/import-driver-scores.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const n = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const REASONS = new Set(["no_activity", "no_employee_match", "inactive", "pto"]);

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows: Row[] = JSON.parse(await readFile(path.join(exportDir, "collections", "DriverScores.json"), "utf8"));
  const byWeek = new Map<string, Row[]>();
  for (const r of rows) byWeek.set(text(r.weekStart), [...(byWeek.get(text(r.weekStart)) ?? []), r]);

  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  let imported = 0, linked = 0;
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const ids = new Set((await db.query("SELECT id FROM employees")).rows.map((r) => r.id as string));

    for (const [week, list] of byWeek) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) continue;
      const end = new Date(`${week}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
      await db.query("DELETE FROM driver_score_reports WHERE company_id = $1 AND week_start = $2", [company.id, week]);
      const report = (await db.query(
        `INSERT INTO driver_score_reports (company_id, week_start, week_end, week_label, fleet_score, source)
         VALUES ($1,$2,$3,$4,$5,'wix_import') RETURNING id`,
        [company.id, week, end.toISOString().slice(0, 10), text(list[0].weekLabel) || week, n(list[0].fleetScoreReported)],
      )).rows[0].id;
      for (const r of list) {
        const employeeId = ids.has(text(r.employeeId)) ? text(r.employeeId) : null;
        if (employeeId) linked++;
        const reason = REASONS.has(text(r.parkedReason)) ? text(r.parkedReason) : null;
        await db.query(
          `INSERT INTO driver_scores (id, report_id, employee_id, vehicle_label, driver_name_raw, group_name, classification, score,
             hard_acceleration_score, harsh_braking_score, harsh_cornering_score, seatbelt_score, speeding_score, distracted_score,
             is_parked, parked_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [r._id, report, employeeId, text(r.vehicle), text(r.name), text(r.group), text(r.classification), n(r.score),
           n(r.hardAccelScore), n(r.harshBrakeScore), n(r.harshCornerScore), n(r.seatbeltScore), n(r.speedingScore), n(r.distractedScore),
           r.parked === true, r.parked === true ? reason : null],
        );
        imported++;
      }
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
  console.log(`Imported from ${exportDir}`);
  console.log(`  ${byWeek.size} weeks, ${imported} driver rows (${linked} linked to an employee)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
