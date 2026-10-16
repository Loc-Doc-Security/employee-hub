/**
 * Weekly Reports API. A direct line from every employee to ownership.
 *
 *   GET  /api/weekly-reports/mine   my current week (report or null) + my full history
 *   POST /api/weekly-reports        submit this week's report (once; no edits afterwards)
 *   GET  /api/weekly-reports/team   managers: who has / hasn't submitted for a week. NO answers.
 *   GET  /api/weekly-reports/all    C-Suite only (weekly_reports.read_all): everyone's answers
 *
 * The submitter and the week always come from the server (session + Eastern-time Monday), never
 * from the request, so nobody can file a report as someone else or into another week.
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { reach } from "../auth/permissions";
import { currentWeekStart, mondayOf } from "../lib/weeks";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

const REPORT_COLUMNS = `id, week_start::text AS week_start, stress_level, morale, workload,
  week_high, week_low, additional_notes, submitted_at`;

/** A requested week, snapped to its Monday; defaults to the current week. */
function weekParam(req: express.Request): string {
  const w = typeof req.query.week === "string" ? req.query.week.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(w) ? mondayOf(w) : currentWeekStart();
}

export function registerWeeklyReportRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };

  app.get("/api/weekly-reports/mine", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const weekStart = currentWeekStart();
      const { rows } = await getProductDb().query(
        `SELECT ${REPORT_COLUMNS} FROM employee_hub.weekly_reports WHERE employee_id = $1 ORDER BY week_start DESC`,
        [access.employeeId],
      );
      send(res, { weekStart, current: rows.find((r) => r.week_start === weekStart) ?? null, history: rows });
    } catch (err) {
      fail(res, 500, `Could not load your reports: ${(err as Error).message}`);
    }
  });

  app.post("/api/weekly-reports", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const b = req.body ?? {};
      const score = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as number) : null);
      const stress = score(b.stressLevel), morale = score(b.morale), workload = score(b.workload);
      const high = typeof b.weekHigh === "string" ? b.weekHigh.trim() : "";
      const low = typeof b.weekLow === "string" ? b.weekLow.trim() : "";
      const notes = typeof b.additionalNotes === "string" ? b.additionalNotes.trim() : "";
      if (stress === null || morale === null || workload === null) return void fail(res, 400, "Stress, morale and workload must each be 1–5.");
      if (!high || !low) return void fail(res, 400, "Your high and low for the week are both required.");

      const { rows } = await getProductDb().query(
        `INSERT INTO employee_hub.weekly_reports
           (company_id, employee_id, week_start, stress_level, morale, workload, week_high, week_low, additional_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING ${REPORT_COLUMNS}`,
        [access.companyId, access.employeeId, currentWeekStart(), stress, morale, workload, high, low, notes],
      );
      send(res, rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return void fail(res, 409, "You've already submitted this week's report.");
      fail(res, 500, `Could not save your report: ${(err as Error).message}`);
    }
  });

  // Managers see completion only. This query never selects an answer column.
  app.get("/api/weekly-reports/team", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const r = reach(access, "reports.view_team");
      if (!r.all && !r.companyIds.length && !r.departmentIds.length) return void fail(res, 403, "Managers only");
      const week = weekParam(req);
      const { rows } = await getProductDb().query(
        `SELECT e.id, e.first_name || ' ' || e.last_name AS name,
                coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id), '') AS departments,
                EXISTS (SELECT 1 FROM employee_hub.weekly_reports w WHERE w.employee_id = e.id AND w.week_start = $1) AS submitted
           FROM employee_hub.employees e
          WHERE e.is_active AND ($2 OR e.company_id = ANY($3::uuid[])
                OR EXISTS (SELECT 1 FROM employee_hub.employee_departments s
                            WHERE s.employee_id = e.id AND s.department_id = ANY($4::uuid[])))
          ORDER BY e.last_name, e.first_name`,
        [week, r.all, r.companyIds, r.departmentIds],
      );
      send(res, { week, people: rows });
    } catch (err) {
      fail(res, 500, `Could not load team status: ${(err as Error).message}`);
    }
  });

  // C-Suite only: the answers.
  app.get("/api/weekly-reports/all", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const r = reach(access, "weekly_reports.read_all");
      if (!r.all && !r.companyIds.length) return void fail(res, 403, "Not available for your role");
      const week = weekParam(req);
      const { rows } = await getProductDb().query(
        `SELECT w.id, w.week_start::text AS week_start, w.stress_level, w.morale, w.workload,
                w.week_high, w.week_low, w.additional_notes, w.submitted_at,
                coalesce(e.first_name || ' ' || e.last_name, w.former_name, w.former_email) AS name,
                e.id IS NULL AS is_former
           FROM employee_hub.weekly_reports w
           LEFT JOIN employee_hub.employees e ON e.id = w.employee_id
          WHERE w.week_start = $1 AND ($2 OR w.company_id = ANY($3::uuid[]))
          ORDER BY name`,
        [week, r.all, r.companyIds],
      );
      send(res, { week, reports: rows });
    } catch (err) {
      fail(res, 500, `Could not load reports: ${(err as Error).message}`);
    }
  });
}
