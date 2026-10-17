/**
 * Imports Wix ExpenseTracking (the latest weekly sync) as one snapshot, dated by the week it was
 * last updated. Wix kept no history, so this is the only past week. Run after import-employees.
 * Usage: npx tsx scripts/migration/import-expense-tracking.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";
import { saveExpenseSync } from "../../server/lib/expenseIngest";
import { mondayOf } from "../../server/lib/weeks";

config({ path: [".env.local", ".env"], quiet: true });

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows = JSON.parse(await readFile(path.join(exportDir, "collections", "ExpenseTracking.json"), "utf8")) as Record<string, unknown>[];
  const lastUpdated = rows.map((r) => String((r._updatedDate as { $date?: string })?.$date ?? "")).sort().pop()!.slice(0, 10);
  const week = mondayOf(lastUpdated);
  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    const r = await saveExpenseSync(db, week, rows.map((x) => ({
      employeeId: String(x.employeeId ?? ""), purchases: Math.round(Number(x.totalPurchases) || 0), receipts: Math.round(Number(x.receiptsUploaded) || 0),
    })), "wix_import");
    await db.query("COMMIT");
    console.log(`Imported from ${exportDir}`);
    console.log(`  week of ${week}: ${r.saved} rows saved; unmatched ${r.unmatched.length}; invalid ${r.invalid.length}`);
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
