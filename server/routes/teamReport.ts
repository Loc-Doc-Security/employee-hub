/**
 * Team Report (the monthly manager meeting view). Levi, 2026-10-16.
 *
 *   GET /api/team-report?month=YYYY-MM            one row per person in my scope: overall, weekly
 *                                                 reports x/y, peer given, cleanliness %, PTO, 1:1
 *   GET /api/team-report/managers?month=YYYY-MM   Operations / C-Suite only: per manager, team size,
 *                                                 team average and 1:1 completion
 *
 * Scope comes from reports.view_team: department managers see their departments; company-wide
 * grants (Operations managers, C-Suite, company admins, super admin) see everyone, and only they
 * get the Managers tab. A 1:1 counts for the month whoever logged it.
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { reach } from "../auth/permissions";
import { cardFor, HISTORY_MONTHS, loadScoringData, monthParam, monthsBack } from "./scorecard";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export function registerTeamReportRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    const r = reach(current.access, "reports.view_team");
    if (!r.all && !r.companyIds.length && !r.departmentIds.length) return void fail(res, 403, "Managers, Operations and C-Suite only");
    return { access: current.access, r, companyWide: r.all || r.companyIds.length > 0 };
  };

  app.get("/api/team-report", async (req, res) => {
    try {
      const ctx = await me(req, res);
      if (!ctx) return;
      const month = monthParam(req);
      const db = getProductDb();
      const { rows } = await db.query(
        `SELECT e.id, e.first_name || ' ' || e.last_name AS name,
                coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id), '') AS departments,
                EXISTS (SELECT 1 FROM employee_hub.one_on_ones o WHERE o.employee_id = e.id AND o.month = $1) AS one_on_one
           FROM employee_hub.employees e
          WHERE e.is_active AND e.id <> $2 AND ($3 OR e.company_id = ANY($4::uuid[])
                OR EXISTS (SELECT 1 FROM employee_hub.employee_departments s WHERE s.employee_id = e.id AND s.department_id = ANY($5::uuid[])))
          ORDER BY e.last_name, e.first_name`,
        [`${month}-01`, ctx.access.employeeId, ctx.r.all, ctx.r.companyIds, ctx.r.departmentIds],
      );
      const data = rows.length ? await loadScoringData(rows.map((p) => p.id), monthsBack(month, HISTORY_MONTHS).pop()!) : null;
      const people = rows.map((p) => {
        const c = cardFor(p.id, data!, month);
        return {
          id: p.id, name: p.name, departments: p.departments, oneOnOne: p.one_on_one,
          overall: c.overall, participation: c.participation, level: c.quarter.level.name,
          weekly: c.items.weeklyReport, peerGiven: c.items.peerAssessment.count, cleanliness: c.items.cleanliness,
          cleanlinessAvg: c.cleanlinessAvg, peerReceivedAvg: c.peerReceivedAvg, ptoWeeks: c.ptoWeeks,
        };
      });
      send(res, { month, companyWide: ctx.companyWide, people });
    } catch (err) {
      fail(res, 500, `Could not load the team report: ${(err as Error).message}`);
    }
  });

  app.get("/api/team-report/managers", async (req, res) => {
    try {
      const ctx = await me(req, res);
      if (!ctx) return;
      if (!ctx.companyWide) return void fail(res, 403, "Operations and C-Suite only");
      const month = monthParam(req);
      const db = getProductDb();
      // Every manager assignment in the companies I can see, with the people it covers.
      const { rows } = await db.query(
        `SELECT m.id AS manager_id, m.first_name || ' ' || m.last_name AS manager, e.id AS employee_id,
                ra.scope_type = 'company' AS company_wide,
                EXISTS (SELECT 1 FROM employee_hub.one_on_ones o WHERE o.employee_id = e.id AND o.month = $1) AS one_on_one
           FROM employee_hub.role_assignments ra
           JOIN employee_hub.roles r ON r.id = ra.role_id AND r.key = 'manager'
           JOIN employee_hub.employees m ON m.id = ra.employee_id AND m.is_active
           JOIN employee_hub.employees e ON e.company_id = ra.company_id AND e.is_active AND e.id <> m.id
                AND (ra.scope_type = 'company' OR EXISTS (SELECT 1 FROM employee_hub.employee_departments ed
                     WHERE ed.employee_id = e.id AND ed.department_id = ra.department_id))
          WHERE $2 OR ra.company_id = ANY($3::uuid[])`,
        [`${month}-01`, ctx.r.all, ctx.r.companyIds],
      );
      const ids = [...new Set(rows.map((x) => x.employee_id as string))];
      const data = ids.length ? await loadScoringData(ids, monthsBack(month, HISTORY_MONTHS).pop()!) : null;
      const overall = new Map(ids.map((id) => [id, cardFor(id, data!, month).overall]));

      const byManager = new Map<string, { id: string; name: string; companyWide: boolean; people: Set<string>; done: Set<string> }>();
      for (const x of rows) {
        const m = byManager.get(x.manager_id) ?? { id: x.manager_id, name: x.manager, companyWide: false, people: new Set(), done: new Set() };
        if (x.company_wide) m.companyWide = true;
        m.people.add(x.employee_id);
        if (x.one_on_one) m.done.add(x.employee_id);
        byManager.set(x.manager_id, m);
      }
      const managers = [...byManager.values()].map((m) => {
        const scores = [...m.people].map((id) => overall.get(id) ?? 0);
        return {
          id: m.id, name: m.name, companyWide: m.companyWide, teamSize: m.people.size,
          teamAverage: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
          oneOnOnesDone: m.done.size,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      send(res, { month, managers });
    } catch (err) {
      fail(res, 500, `Could not load the managers view: ${(err as Error).message}`);
    }
  });
}
