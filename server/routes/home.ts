/**
 * Home page: the manager card. (Everything else on Home comes from each feature's own "mine"
 * endpoint, so Home can never disagree with the feature pages.)
 *
 *   GET /api/home/team   for people in my reports.view_team scope (never me): who hasn't done this
 *                        week's weekly report and cleanliness audit yet, who hasn't given a peer
 *                        assessment this month, and this month's 1:1s.
 *
 * Done / not done only, never answers or scores, the same detail Team Report already shows managers.
 * People on PTO that week aren't counted. Audits are only expected from people with a vehicle or
 * an office (the cleanliness report's rule).
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { reach } from "../auth/permissions";
import { auditWeekStart, currentMonthStart, currentWeekStart, ptoWeekForAuditWeek } from "../lib/weeks";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export function registerHomeRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  app.get("/api/home/team", async (req, res) => {
    try {
      const current = await resolveCurrent(req, getAuthUser);
      if (!current) return void fail(res, 401, "Sign in required");
      const access = current.access;
      if (!access) return void fail(res, 403, "No employee profile for this account");
      const r = reach(access, "reports.view_team");
      if (!r.all && !r.companyIds.length && !r.departmentIds.length) return void send(res, null);

      const week = currentWeekStart();
      const auditWeek = auditWeekStart();
      const month = currentMonthStart();
      const { rows } = await getProductDb().query(
        `SELECT e.first_name || ' ' || e.last_name AS name,
                (coalesce(trim(e.vehicle_number), '') <> '' OR e.has_office) AS audits,
                EXISTS (SELECT 1 FROM employee_hub.weekly_reports w WHERE w.employee_id = e.id AND w.week_start = $1) AS weekly_done,
                EXISTS (SELECT 1 FROM employee_hub.pto_weeks p WHERE p.employee_id = e.id AND p.week_start = $1 AND p.removed_at IS NULL) AS pto_now,
                EXISTS (SELECT 1 FROM employee_hub.cleanliness_audits a WHERE a.employee_id = e.id AND a.week_start = $2) AS audit_done,
                EXISTS (SELECT 1 FROM employee_hub.pto_weeks p WHERE p.employee_id = e.id AND p.week_start = $3 AND p.removed_at IS NULL) AS pto_audit,
                EXISTS (SELECT 1 FROM employee_hub.one_on_ones o WHERE o.employee_id = e.id AND o.month = $4) AS one_on_one,
                EXISTS (SELECT 1 FROM employee_hub.peer_assessments a WHERE a.submitted_by_id = e.id AND a.month = $4) AS peer_given
           FROM employee_hub.employees e
          WHERE e.is_active AND e.id <> $5 AND ($6 OR e.company_id = ANY($7::uuid[])
                OR EXISTS (SELECT 1 FROM employee_hub.employee_departments s WHERE s.employee_id = e.id AND s.department_id = ANY($8::uuid[])))
          ORDER BY e.last_name, e.first_name`,
        [week, auditWeek, ptoWeekForAuditWeek(auditWeek), month, access.employeeId, r.all, r.companyIds, r.departmentIds]);

      const weeklyExpected = rows.filter((p) => !p.pto_now);
      const auditExpected = rows.filter((p) => p.audits && !p.pto_audit);
      send(res, {
        people: rows.length,
        weekly: { expected: weeklyExpected.length, missing: weeklyExpected.filter((p) => !p.weekly_done).map((p) => p.name) },
        cleanliness: { expected: auditExpected.length, missing: auditExpected.filter((p) => !p.audit_done).map((p) => p.name) },
        peer: { expected: rows.length, missing: rows.filter((p) => !p.peer_given).map((p) => p.name) },
        oneOnOnes: { done: rows.filter((p) => p.one_on_one).length, total: rows.length, missing: rows.filter((p) => !p.one_on_one).map((p) => p.name) },
      });
    } catch (err) {
      fail(res, 500, `Could not load your team: ${(err as Error).message}`);
    }
  });
}
