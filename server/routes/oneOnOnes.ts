/**
 * 1:1 meetings API.
 *
 *   GET  /api/one-on-ones/roster            people I can read (or write) 1:1s for + done this month
 *   GET  /api/one-on-ones/employee/:id      that person's 1:1 history + this month's review numbers
 *   GET  /api/one-on-ones/mine              my own 1:1s (every employee)
 *   POST /api/one-on-ones                   log a 1:1 (managers, for their people; no edits after)
 *
 * The review numbers follow every other privacy rule: weekly reports are a COUNT only, peer
 * assessments are averages only. Driver scores are included for reference (not scored).
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { can, reach } from "../auth/permissions";
import { employeeTarget } from "../auth/targets";
import { currentMonthStart, localDate } from "../lib/weeks";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

const HISTORY_COLUMNS = `o.id, o.met_on::text AS met_on, o.areas_of_improvement, o.whats_going_well, o.whats_not_going_well,
  o.needs, o.how_can_i_help, o.site_visits, o.follow_ups, o.created_at,
  coalesce(m.first_name || ' ' || m.last_name, o.manager_former_name) AS manager`;
const TEXT_FIELDS = ["areasOfImprovement", "whatsGoingWell", "whatsNotGoingWell", "needs", "howCanIHelp", "followUps"] as const;

export function registerOneOnOneRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };

  app.get("/api/one-on-ones/roster", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const r = reach(access, "one_on_ones.read");
      if (!r.all && !r.companyIds.length && !r.departmentIds.length) return void fail(res, 403, "Managers, Operations and C-Suite only");
      const month = currentMonthStart();
      const { rows } = await getProductDb().query(
        `SELECT e.id, e.first_name || ' ' || e.last_name AS name,
                coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id), '') AS departments,
                EXISTS (SELECT 1 FROM employee_hub.one_on_ones o WHERE o.employee_id = e.id AND o.month = $1) AS done_this_month,
                (SELECT max(o.met_on)::text FROM employee_hub.one_on_ones o WHERE o.employee_id = e.id) AS last_met_on
           FROM employee_hub.employees e
          WHERE e.is_active AND e.id <> $2 AND ($3 OR e.company_id = ANY($4::uuid[])
                OR EXISTS (SELECT 1 FROM employee_hub.employee_departments s
                            WHERE s.employee_id = e.id AND s.department_id = ANY($5::uuid[])))
          ORDER BY e.last_name, e.first_name`,
        [month, access.employeeId, r.all, r.companyIds, r.departmentIds],
      );
      const people = await Promise.all(rows.map(async (p) => {
        const target = await employeeTarget(p.id);
        return { ...p, canWrite: !!target && can(access, "one_on_ones.write", target) };
      }));
      send(res, { month: month.slice(0, 7), people });
    } catch (err) {
      fail(res, 500, `Could not load your team: ${(err as Error).message}`);
    }
  });

  app.get("/api/one-on-ones/employee/:id", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const id = req.params.id;
      const target = await employeeTarget(id);
      if (!target) return void fail(res, 404, "Employee not found");
      if (id !== access.employeeId && !can(access, "one_on_ones.read", target)) return void fail(res, 403, "Not allowed");
      const db = getProductDb();
      const history = (await db.query(
        `SELECT ${HISTORY_COLUMNS} FROM employee_hub.one_on_ones o
           LEFT JOIN employee_hub.employees m ON m.id = o.manager_id
          WHERE o.employee_id = $1 ORDER BY o.met_on DESC, o.created_at DESC`, [id])).rows;

      // This month's review numbers (counts and averages only).
      const month = currentMonthStart();
      const today = localDate(new Date());
      const weekly = (await db.query(
        `SELECT count(*)::int AS submitted,
                (SELECT count(*)::int FROM generate_series($2::date, $3::date, '1 day') d WHERE extract(isodow FROM d) = 1) AS weeks_so_far
           FROM employee_hub.weekly_reports WHERE employee_id = $1 AND week_start >= $2 AND week_start <= $3`,
        [id, month, today])).rows[0];
      const peer = (await db.query(
        `SELECT count(*)::int AS received,
                round(avg((humble + hungry + smart + helpful_kind + fast_response + solves_problems) / 6.0), 2)::float AS overall
           FROM employee_hub.peer_assessments WHERE subject_id = $1 AND month = $2`, [id, month])).rows[0];
      const cleanliness = (await db.query(
        `SELECT week_start::text AS week, score FROM employee_hub.cleanliness_audits
          WHERE employee_id = $1 AND week_start >= $2 AND week_start <= $3 ORDER BY week_start`, [id, month, today])).rows;
      const pto = (await db.query(
        `SELECT week_start::text AS week FROM employee_hub.pto_weeks
          WHERE employee_id = $1 AND removed_at IS NULL AND week_start >= ($2::date - 6) AND week_start <= $3 ORDER BY week_start`,
        [id, month, today])).rows.map((r) => r.week);

      const driver = (await db.query(
        `SELECT r.week_label, d.score::float AS score, d.is_parked, d.parked_reason
           FROM employee_hub.driver_scores d JOIN employee_hub.driver_score_reports r ON r.id = d.report_id
          WHERE d.employee_id = $1 AND r.week_end >= $2 AND r.week_start <= $3 ORDER BY r.week_start`, [id, month, today])).rows;

      send(res, {
        canWrite: id !== access.employeeId && can(access, "one_on_ones.write", target),
        history,
        review: { month: month.slice(0, 7), weekly, peer, cleanliness, pto, driver },
      });
    } catch (err) {
      fail(res, 500, `Could not load 1:1s: ${(err as Error).message}`);
    }
  });

  app.get("/api/one-on-ones/mine", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const { rows } = await getProductDb().query(
        `SELECT ${HISTORY_COLUMNS} FROM employee_hub.one_on_ones o
           LEFT JOIN employee_hub.employees m ON m.id = o.manager_id
          WHERE o.employee_id = $1 ORDER BY o.met_on DESC, o.created_at DESC`, [access.employeeId]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load your 1:1s: ${(err as Error).message}`);
    }
  });

  app.post("/api/one-on-ones", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const b = req.body ?? {};
      const employeeId = typeof b.employeeId === "string" ? b.employeeId : "";
      const metOn = typeof b.metOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.metOn) ? b.metOn : "";
      if (!employeeId) return void fail(res, 400, "Pick an employee.");
      if (employeeId === access.employeeId) return void fail(res, 400, "You can't log a 1:1 with yourself.");
      if (!metOn) return void fail(res, 400, "Pick the meeting date.");
      if (metOn > localDate(new Date())) return void fail(res, 400, "The meeting date can't be in the future.");
      const target = await employeeTarget(employeeId);
      if (!target || !target.isActive) return void fail(res, 404, "Employee not found or inactive.");
      if (!can(access, "one_on_ones.write", target)) return void fail(res, 403, "Only this person's managers can log a 1:1 for them.");

      const t = Object.fromEntries(TEXT_FIELDS.map((k) => [k, typeof b[k] === "string" ? b[k].trim() : ""])) as Record<(typeof TEXT_FIELDS)[number], string>;
      if (!Object.values(t).some(Boolean)) return void fail(res, 400, "Add at least some notes before saving.");
      const visits = Array.isArray(b.siteVisits)
        ? b.siteVisits.map((v: { label?: unknown; notes?: unknown }) => ({ label: String(v?.label ?? "").trim(), notes: String(v?.notes ?? "").trim() }))
            .filter((v: { label: string; notes: string }) => v.label || v.notes).slice(0, 50)
        : [];

      const { rows } = await getProductDb().query(
        `INSERT INTO employee_hub.one_on_ones (company_id, employee_id, manager_id, met_on, month,
           areas_of_improvement, whats_going_well, whats_not_going_well, needs, how_can_i_help, site_visits, follow_ups)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [target.companyId, employeeId, access.employeeId, metOn, `${metOn.slice(0, 7)}-01`, t.areasOfImprovement,
         t.whatsGoingWell, t.whatsNotGoingWell, t.needs, t.howCanIHelp, JSON.stringify(visits), t.followUps],
      );
      send(res, { id: rows[0].id });
    } catch (err) {
      fail(res, 500, `Could not save the 1:1: ${(err as Error).message}`);
    }
  });
}
