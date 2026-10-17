// Saves one weekly expense sync. Used by the n8n endpoint and the Wix import, so both write the same
// way. Rows are matched by employee id; unknown ids are returned (never silently dropped) so n8n's
// "unmatched" report can surface a typo in the sheet's Employee Number column. A week synced twice
// replaces that week's numbers (each employee's company gets its own snapshot).
import type pg from "pg";

export type SyncRow = { employeeId: string; purchases: number; receipts: number };

export async function saveExpenseSync(db: pg.PoolClient | pg.Client, weekStart: string, rows: SyncRow[], source: "n8n" | "wix_import") {
  const ids = rows.map((r) => r.employeeId).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const known = new Map((await db.query(
    "SELECT id, company_id FROM employee_hub.employees WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => [r.id as string, r.company_id as string]));
  const unmatched = rows.filter((r) => !known.has(r.employeeId)).map((r) => r.employeeId);
  const invalid: string[] = [];

  const byCompany = new Map<string, SyncRow[]>();
  for (const r of rows) {
    const company = known.get(r.employeeId);
    if (!company) continue;
    if (!Number.isInteger(r.purchases) || !Number.isInteger(r.receipts) || r.purchases < 0 || r.receipts < 0) { invalid.push(r.employeeId); continue; }
    byCompany.set(company, [...(byCompany.get(company) ?? []), r]);
  }
  let saved = 0;
  for (const [companyId, list] of byCompany) {
    await db.query("DELETE FROM employee_hub.expense_snapshots WHERE company_id = $1 AND week_start = $2", [companyId, weekStart]);
    const snap = (await db.query(
      "INSERT INTO employee_hub.expense_snapshots (company_id, week_start, source) VALUES ($1,$2,$3) RETURNING id",
      [companyId, weekStart, source])).rows[0].id;
    for (const r of list) {
      await db.query(
        `INSERT INTO employee_hub.expense_tracking (snapshot_id, employee_id, total_purchases, receipts_uploaded)
         VALUES ($1,$2,$3,$4) ON CONFLICT (snapshot_id, employee_id) DO UPDATE
         SET total_purchases = EXCLUDED.total_purchases, receipts_uploaded = EXCLUDED.receipts_uploaded`,
        [snap, r.employeeId, r.purchases, r.receipts]);
      saved++;
    }
  }
  return { saved, unmatched, invalid };
}
