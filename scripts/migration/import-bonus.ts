/**
 * Imports Wix BonusPools and BonusCalculations (company: Loc-Doc). Run after import-employees.
 * Periods like "September 2026" become months; each period's rows become that month's saved run.
 * Rows whose employee isn't in the hub are reported, not dropped silently. Safe to re-run: an
 * imported month is replaced, but a month already saved in the hub is left alone.
 *
 * Usage: npx tsx scripts/migration/import-bonus.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const stamp = (v: unknown) => (v && typeof v === "object" && "$date" in v ? (v as { $date: string }).$date : null);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function monthOf(period: string): string | null {
  const m = period.toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  return i < 0 ? null : `${m![2]}-${String(i + 1).padStart(2, "0")}-01`;
}

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const read = async (name: string): Promise<Row[]> => JSON.parse(await readFile(path.join(exportDir, "collections", `${name}.json`), "utf8"));
  const pools = await read("BonusPools");
  const calcs = await read("BonusCalculations");
  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { pools: 0, runs: 0, payouts: 0, skippedManual: [] as string[], badPeriod: [] as string[], noEmployee: [] as string[] };
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const byEmail = new Map((await db.query("SELECT id, lower(email) AS email FROM employees")).rows.map((r) => [r.email as string, r.id as string]));
    const known = new Set((await db.query("SELECT id FROM employees")).rows.map((r) => r.id as string));

    for (const p of pools) {
      const month = monthOf(text(p.period));
      if (!month || !(Number(p.poolAmount) > 0)) { n.badPeriod.push(`pool ${text(p.period)}`); continue; }
      await db.query(
        `INSERT INTO bonus_pools (company_id, month, amount, set_by_id, set_by_name, set_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (company_id, month) DO UPDATE SET amount = EXCLUDED.amount, set_by_id = EXCLUDED.set_by_id,
           set_by_name = EXCLUDED.set_by_name, set_at = EXCLUDED.set_at`,
        [company.id, month, Number(p.poolAmount), byEmail.get(text(p.setBy).toLowerCase()) ?? null, text(p.setByName) || null,
         stamp(p._updatedDate) ?? stamp(p._createdDate)]);
      n.pools++;
    }

    const byMonth = new Map<string, Row[]>();
    for (const c of calcs) {
      const month = monthOf(text(c.period));
      if (!month) { n.badPeriod.push(`${text(c.employeeName)} (${text(c.period)})`); continue; }
      byMonth.set(month, [...(byMonth.get(month) ?? []), c]);
    }
    for (const [month, rows] of byMonth) {
      const existing = (await db.query("SELECT id, source FROM bonus_runs WHERE company_id = $1 AND month = $2", [company.id, month])).rows[0];
      if (existing?.source === "manual") { n.skippedManual.push(month.slice(0, 7)); continue; }
      if (existing) await db.query("DELETE FROM bonus_runs WHERE id = $1", [existing.id]);
      const first = rows[0];
      const runId = (await db.query(
        `INSERT INTO bonus_runs (company_id, month, pool_amount, saved_by_id, saved_by_name, saved_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,'wix_import') RETURNING id`,
        [company.id, month, Number(first.poolAmount), byEmail.get(text(first.enteredBy).toLowerCase()) ?? null,
         text(first.enteredByName) || null, stamp(first._createdDate)])).rows[0].id;
      n.runs++;
      for (const c of rows) {
        const id = text(c.employeeId);
        if (!known.has(id)) { n.noEmployee.push(text(c.employeeName)); continue; }
        const status = text(c.status) === "excluded" ? "excluded" : "confirmed";
        await db.query(
          `INSERT INTO bonus_payouts (run_id, employee_id, employee_name, team, reliability_score, reliability_share, profitability_score,
             profitability_share, tenure_years, tenure_share, suggested_bonus, status, payout)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [runId, id, text(c.employeeName), text(c.department) || "No team", Number(c.reliabilityScore) || 0, Number(c.reliabilityShare) || 0,
           Math.min(4, Math.max(2, Math.round(Number(c.profitabilityScore) || 3))), Number(c.profitabilityShare) || 0,
           Number(c.tenureYears) || 0, Number(c.tenureShare) || 0, Number(c.suggestedBonus) || 0, status,
           status === "excluded" ? 0 : Math.round(Number(c.actualPayout) || 0)]);
        n.payouts++;
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
  console.log(`  ${n.pools} pools, ${n.runs} runs, ${n.payouts} payouts`);
  if (n.skippedManual.length) console.log(`  left alone (already saved in the hub): ${n.skippedManual.join(", ")}`);
  if (n.badPeriod.length) console.log(`  skipped (unreadable period or amount): ${n.badPeriod.join(", ")}`);
  if (n.noEmployee.length) console.log(`  skipped (employee not in the hub): ${n.noEmployee.join(", ")}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
