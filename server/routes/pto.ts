/**
 * PTO: a one-button manager decision exempting someone for a work week, across every report
 * (cleanliness audit, driver scorecard, weekly-report team status). Levi, 2026-10-16.
 *
 *   POST   /api/pto  { employeeId, week }   mark (week = any date in that work week)
 *   DELETE /api/pto  { employeeId, week }   remove: stamps removed_at/removed_by; never deletes
 *
 * Allowed for people with pto.mark covering the employee: managers for their departments,
 * company admins, super admins.
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { can } from "../auth/permissions";
import { employeeTarget } from "../auth/targets";
import { mondayOf } from "../lib/weeks";

const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export function registerPtoRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const authorize = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    const access = current.access;
    if (!access) return void fail(res, 403, "No employee profile for this account");
    const employeeId = typeof req.body?.employeeId === "string" ? req.body.employeeId : "";
    const week = typeof req.body?.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.week) ? mondayOf(req.body.week) : "";
    if (!employeeId || !week) return void fail(res, 400, "Missing employee or week.");
    const target = await employeeTarget(employeeId);
    if (!target) return void fail(res, 404, "Employee not found.");
    if (!can(access, "pto.mark", target)) return void fail(res, 403, "You can't mark PTO for this person's department.");
    return { access, employeeId, week, companyId: target.companyId };
  };

  app.post("/api/pto", async (req, res) => {
    try {
      const a = await authorize(req, res);
      if (!a) return;
      const db = getProductDb();
      const existing = await db.query(
        "SELECT id FROM employee_hub.pto_weeks WHERE employee_id = $1 AND week_start = $2 AND removed_at IS NULL",
        [a.employeeId, a.week],
      );
      if (!existing.rows.length) {
        await db.query(
          `INSERT INTO employee_hub.pto_weeks (company_id, employee_id, week_start, marked_by_id)
           VALUES ($1,$2,$3,$4)`,
          [a.companyId, a.employeeId, a.week, a.access.employeeId],
        );
      }
      res.json({ ok: true, data: { employeeId: a.employeeId, week: a.week } });
    } catch (err) {
      fail(res, 500, `Could not mark PTO: ${(err as Error).message}`);
    }
  });

  app.delete("/api/pto", async (req, res) => {
    try {
      const a = await authorize(req, res);
      if (!a) return;
      await getProductDb().query(
        `UPDATE employee_hub.pto_weeks SET removed_at = now(), removed_by_id = $3
          WHERE employee_id = $1 AND week_start = $2 AND removed_at IS NULL`,
        [a.employeeId, a.week, a.access.employeeId],
      );
      res.json({ ok: true, data: { employeeId: a.employeeId, week: a.week } });
    } catch (err) {
      fail(res, 500, `Could not remove PTO: ${(err as Error).message}`);
    }
  });
}
