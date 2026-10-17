/**
 * Credit card receipt report + the n8n weekly sync endpoint.
 *
 * Visibility (Levi, 2026-10-16):
 *   - everyone: company and team (department) totals, never anyone else's individual numbers
 *   - each person: their own numbers and their team's total
 *   - managers (reports.view_team): their teams' totals and the individuals in them
 *
 *   GET  /api/credit-card/report?week=YYYY-MM-DD     latest (or that) weekly snapshot
 *   POST /api/integrations/expense-tracking          n8n, header x-integration-key = N8N_INTEGRATION_KEY
 *        { weekOf?: "YYYY-MM-DD", rows: [{ employeeId, totalPurchases, receiptsUploaded }] }
 *
 * Teams are the employee's Employee Hub department(s); C-Suite (a role, no department) shows as
 * "C-Suite"; anyone else without one as "No department".
 */
import type express from "express";
import { timingSafeEqual } from "crypto";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { reach } from "../auth/permissions";
import { aggregate, pct } from "../lib/expenses";
import { saveExpenseSync } from "../lib/expenseIngest";
import { localDate, mondayOf } from "../lib/weeks";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export function registerCreditCardRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  app.get("/api/credit-card/report", async (req, res) => {
    try {
      const current = await resolveCurrent(req, getAuthUser);
      if (!current) return void fail(res, 401, "Sign in required");
      const access = current.access;
      if (!access) return void fail(res, 403, "No employee profile for this account");
      const db = getProductDb();
      const weeks = (await db.query(
        "SELECT id, week_start::text AS week_start FROM employee_hub.expense_snapshots WHERE company_id = $1 ORDER BY week_start DESC",
        [access.companyId])).rows;
      if (!weeks.length) return void send(res, null);
      const wanted = typeof req.query.week === "string" ? weeks.find((w) => w.week_start === req.query.week) : null;
      const snap = wanted ?? weeks[0];

      const rows = (await db.query(
        `SELECT t.employee_id, t.total_purchases, t.receipts_uploaded, e.first_name || ' ' || e.last_name AS name,
                coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id),
                         CASE WHEN EXISTS (SELECT 1 FROM employee_hub.role_assignments ra JOIN employee_hub.roles r ON r.id = ra.role_id
                                           WHERE ra.employee_id = e.id AND r.key = 'csuite') THEN 'C-Suite' ELSE 'No department' END) AS department,
                coalesce((SELECT array_agg(ed.department_id) FROM employee_hub.employee_departments ed WHERE ed.employee_id = e.id), '{}') AS department_ids
           FROM employee_hub.expense_tracking t JOIN employee_hub.employees e ON e.id = t.employee_id
          WHERE t.snapshot_id = $1 ORDER BY e.last_name, e.first_name`, [snap.id])).rows;
      const summary = aggregate(rows.map((r) => ({ employeeId: r.employee_id, department: r.department, purchases: r.total_purchases, receipts: r.receipts_uploaded })));

      const mineRow = rows.find((r) => r.employee_id === access.employeeId);
      const mine = mineRow ? {
        purchases: mineRow.total_purchases, receipts: mineRow.receipts_uploaded,
        percent: pct(mineRow.receipts_uploaded, mineRow.total_purchases), department: mineRow.department,
        departmentPercent: summary.departments.find((d) => d.department === mineRow.department)?.percent ?? null,
      } : null;

      // Managers: individuals in their scope (never themselves; their own numbers are in `mine`).
      const r = reach(access, "reports.view_team");
      const isManager = r.all || r.companyIds.length > 0 || r.departmentIds.length > 0;
      const team = isManager ? rows
        .filter((x) => x.employee_id !== access.employeeId)
        .filter((x) => r.all || r.companyIds.includes(access.companyId) || (x.department_ids as string[]).some((d) => r.departmentIds.includes(d)))
        .map((x) => ({ name: x.name, department: x.department, purchases: x.total_purchases, receipts: x.receipts_uploaded, percent: pct(x.receipts_uploaded, x.total_purchases) }))
        .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.name.localeCompare(b.name)) // lowest first: who needs a nudge
        : null;

      const trend = (await db.query(
        `SELECT s.week_start::text AS week, sum(t.receipts_uploaded)::int AS receipts, sum(t.total_purchases)::int AS purchases
           FROM employee_hub.expense_snapshots s JOIN employee_hub.expense_tracking t ON t.snapshot_id = s.id
          WHERE s.company_id = $1 GROUP BY s.week_start ORDER BY s.week_start`, [access.companyId])).rows
        .map((t) => ({ week: t.week, percent: pct(t.receipts, t.purchases) }));

      send(res, { week: snap.week_start, weeks: weeks.map((w) => w.week_start), ...summary, mine, team, trend });
    } catch (err) {
      fail(res, 500, `Could not load the credit card report: ${(err as Error).message}`);
    }
  });

  app.post("/api/integrations/expense-tracking", async (req, res) => {
    try {
      const expected = process.env.N8N_INTEGRATION_KEY?.trim();
      if (!expected) return void fail(res, 503, "N8N_INTEGRATION_KEY is not configured on this server.");
      const given = String(req.header("x-integration-key") ?? "");
      const ok = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      if (!ok) return void fail(res, 401, "Invalid integration key.");

      const b = req.body ?? {};
      if (!Array.isArray(b.rows) || !b.rows.length) return void fail(res, 400, "Send { rows: [{ employeeId, totalPurchases, receiptsUploaded }] }.");
      const weekOf = typeof b.weekOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.weekOf) ? b.weekOf : localDate(new Date());
      const rows = b.rows.map((x: Record<string, unknown>) => ({
        employeeId: String(x.employeeId ?? "").trim(),
        purchases: Math.round(Number(x.totalPurchases)), receipts: Math.round(Number(x.receiptsUploaded)),
      }));
      const client = await getProductDb().connect();
      try {
        await client.query("BEGIN");
        const result = await saveExpenseSync(client, mondayOf(weekOf), rows, "n8n");
        await client.query("COMMIT");
        send(res, { weekStart: mondayOf(weekOf), ...result });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      fail(res, 500, `Sync failed: ${(err as Error).message}`);
    }
  });
}
