/**
 * Cleanliness Audit API.
 *
 *   GET /api/cleanliness/form?for=&week=   the form for me (this week), or for someone else when a
 *                                          manager/admin is fixing or filling in their audit
 *   PUT /api/cleanliness/audit             save (insert or edit) an audit; the server scores it
 *   GET /api/cleanliness/report?week=      company report: participants, scores, PTO, trend
 *
 * Rules (Levi, 2026-10-16, carried over from Wix):
 *   - Week = Wednesday 9am → Tuesday night (Eastern); locked Wed 00:00–09:00 for the meeting.
 *   - Employees save/edit their own audit for the current week until it closes.
 *   - Managers (their departments) and Cleanliness Admins (anyone) can fix or fill in any week.
 *   - Any manager can VIEW the whole company report; marking PTO / fixing stays department-scoped.
 *   - A real submission always counts, even if the week is also marked PTO.
 */
import type express from "express";
import type pg from "pg";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { can, type Access } from "../auth/permissions";
import { employeeTarget } from "../auth/targets";
import { auditWeekStart, isAuditLocked, mondayOf, ptoWeekForAuditWeek } from "../lib/weeks";
import { scoreAudit, SECTIONS, type Answers, type Photos } from "../lib/cleanliness";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

const AUDIT_COLUMNS = `id, employee_id, week_start::text AS week_start, has_vehicle, has_office, vehicle_number, answers,
  photos, pass_count, total_count, score, vehicle_score, office_score, submitted_at, edit_count, last_edited_at`;

/** Companies where the caller has a permission at any scope (null = every company). */
function companiesWith(access: Access, permission: string): string[] | null {
  const grants = access.grants.filter((g) => g.permission === permission);
  if (grants.some((g) => g.scope.type === "global")) return null;
  return [...new Set(grants.flatMap((g) => (g.scope.type === "global" ? [] : [g.scope.companyId])))];
}

async function canEditFor(access: Access, employeeId: string) {
  if (employeeId === access.employeeId) return { ok: true, other: false };
  const target = await employeeTarget(employeeId);
  if (!target) return { ok: false, other: true };
  return {
    ok: can(access, "cleanliness.edit_team", target) || can(access, "cleanliness.edit_any", { companyId: target.companyId }),
    other: true,
  };
}

/** A valid audit week (a Wednesday) from a query/body value, or null. */
function wednesdayParam(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return new Date(`${v}T12:00:00Z`).getUTCDay() === 3 ? v : null;
}

async function loadEmployee(db: pg.Pool, id: string) {
  return (await db.query(
    `SELECT id, company_id, first_name, last_name, vehicle_number, vehicle_noun, has_office
       FROM employee_hub.employees WHERE id = $1 AND is_active`, [id])).rows[0] ?? null;
}

export function registerCleanlinessRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };

  app.get("/api/cleanliness/form", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const forId = typeof req.query.for === "string" && req.query.for ? req.query.for : access.employeeId;
      const perm = await canEditFor(access, forId);
      if (!perm.ok) return void fail(res, 403, "You can't edit this person's audit.");
      const db = getProductDb();
      const emp = await loadEmployee(db, forId);
      if (!emp) return void fail(res, 404, "Employee not found or inactive.");

      const currentWeek = auditWeekStart();
      const week = perm.other ? (wednesdayParam(req.query.week) ?? currentWeek) : currentWeek;
      const audit = (await db.query(
        `SELECT ${AUDIT_COLUMNS} FROM employee_hub.cleanliness_audits WHERE employee_id = $1 AND week_start = $2`,
        [forId, week])).rows[0] ?? null;
      const pto = (await db.query(
        "SELECT 1 FROM employee_hub.pto_weeks WHERE employee_id = $1 AND week_start = $2 AND removed_at IS NULL",
        [forId, ptoWeekForAuditWeek(week)])).rows.length > 0;

      send(res, {
        week, currentWeek,
        locked: !perm.other && isAuditLocked(),
        editingFor: perm.other ? { id: emp.id, name: `${emp.first_name} ${emp.last_name}` } : null,
        sections: { vehicle: !!String(emp.vehicle_number ?? "").trim(), office: !!emp.has_office },
        noun: emp.vehicle_noun ? String(emp.vehicle_noun).toLowerCase() : "vehicle",
        vehicleNumber: emp.vehicle_number ?? "",
        questions: SECTIONS,
        onPto: pto,
        audit,
      });
    } catch (err) {
      fail(res, 500, `Could not load the audit: ${(err as Error).message}`);
    }
  });

  app.put("/api/cleanliness/audit", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const b = req.body ?? {};
      const forId = typeof b.employeeId === "string" && b.employeeId ? b.employeeId : access.employeeId;
      const perm = await canEditFor(access, forId);
      if (!perm.ok) return void fail(res, 403, "You can't edit this person's audit.");
      if (!perm.other && isAuditLocked()) return void fail(res, 423, "Reporting is locked until 9am Wednesday.");

      const currentWeek = auditWeekStart();
      const week = perm.other ? (wednesdayParam(b.week) ?? currentWeek) : currentWeek;
      if (week > currentWeek) return void fail(res, 400, "That week hasn't started yet.");

      const db = getProductDb();
      const emp = await loadEmployee(db, forId);
      if (!emp) return void fail(res, 404, "Employee not found or inactive.");
      const active = { vehicle: !!String(emp.vehicle_number ?? "").trim(), office: !!emp.has_office };
      if (!active.vehicle && !active.office) return void fail(res, 400, "This person has no vehicle or office to audit.");

      // Photos must be uploads that exist, belong to this company, and were made for cleanliness.
      const photos: Photos = {};
      const requested = (b.photos && typeof b.photos === "object" ? b.photos : {}) as Record<string, unknown>;
      const ids = Object.values(requested).filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v));
      const valid = ids.length ? new Set((await db.query(
        "SELECT id FROM employee_hub.uploads WHERE id = ANY($1::uuid[]) AND company_id = $2 AND purpose = 'cleanliness'",
        [ids, emp.company_id])).rows.map((r) => r.id as string)) : new Set<string>();
      for (const [slot, id] of Object.entries(requested)) if (typeof id === "string" && valid.has(id)) photos[slot] = id;

      const s = scoreAudit(active, (b.answers ?? {}) as Answers, photos);
      const vehicleNumber = active.vehicle ? String(b.vehicleNumber ?? emp.vehicle_number ?? "").trim() || emp.vehicle_number : null;

      const { rows } = await db.query(
        `INSERT INTO employee_hub.cleanliness_audits (company_id, employee_id, week_start, has_vehicle, has_office,
           vehicle_number, answers, photos, pass_count, total_count, score, vehicle_score, office_score, submitted_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (employee_id, week_start) DO UPDATE SET
           has_vehicle = EXCLUDED.has_vehicle, has_office = EXCLUDED.has_office, vehicle_number = EXCLUDED.vehicle_number,
           answers = EXCLUDED.answers, photos = EXCLUDED.photos, pass_count = EXCLUDED.pass_count,
           total_count = EXCLUDED.total_count, score = EXCLUDED.score, vehicle_score = EXCLUDED.vehicle_score,
           office_score = EXCLUDED.office_score, edit_count = employee_hub.cleanliness_audits.edit_count + 1,
           last_edited_at = now(), last_edited_by_id = $14
         RETURNING ${AUDIT_COLUMNS}, (xmax <> 0) AS was_edit`,
        [emp.company_id, forId, week, active.vehicle, active.office, vehicleNumber, JSON.stringify(s.answers),
         JSON.stringify(s.photos), s.passCount, s.totalCount, s.score, s.vehicleScore, s.officeScore, access.employeeId],
      );
      send(res, rows[0]);
    } catch (err) {
      fail(res, 500, `Could not save the audit: ${(err as Error).message}`);
    }
  });

  app.get("/api/cleanliness/report", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const companies = companiesWith(access, "cleanliness.view_report");
      if (companies !== null && !companies.length) return void fail(res, 403, "Managers and admins only");
      const db = getProductDb();
      const week = wednesdayParam(req.query.week) ?? auditWeekStart();
      const scope = companies === null ? "TRUE" : "e.company_id = ANY($2::uuid[])";
      const args: unknown[] = [week];
      if (companies !== null) args.push(companies);

      const { rows } = await db.query(
        `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.vehicle_number, e.has_office,
                b.name AS branch,
                coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id), '') AS departments,
                a.id AS audit_id, a.score, a.vehicle_score, a.office_score, a.submitted_at, a.edit_count, a.answers, a.photos,
                p.marked_at AS pto_marked_at,
                coalesce(m.first_name || ' ' || m.last_name, p.marked_by_name) AS pto_marked_by
           FROM employee_hub.employees e
           LEFT JOIN employee_hub.branches b ON b.id = e.branch_id
           LEFT JOIN employee_hub.cleanliness_audits a ON a.employee_id = e.id AND a.week_start = $1
           LEFT JOIN employee_hub.pto_weeks p ON p.employee_id = e.id AND p.week_start = ($1::date - 2) AND p.removed_at IS NULL
           LEFT JOIN employee_hub.employees m ON m.id = p.marked_by_id
          WHERE e.is_active AND (coalesce(trim(e.vehicle_number), '') <> '' OR e.has_office) AND ${scope}
          ORDER BY e.last_name, e.first_name`,
        args,
      );
      // Per-row actions, decided here so the page shows exactly what the server will allow.
      const people = await Promise.all(rows.map(async (r) => {
        const target = await employeeTarget(r.id);
        return {
          ...r,
          status: r.audit_id ? "submitted" : r.pto_marked_at ? "pto" : "missing",
          canMarkPto: !!target && can(access, "pto.mark", target),
          canFix: !!target && (can(access, "cleanliness.edit_team", target) || can(access, "cleanliness.edit_any", { companyId: target.companyId })),
        };
      }));
      const trend = await db.query(
        `SELECT a.week_start::text AS week, round(avg(a.score))::int AS avg_score, count(*)::int AS submitted
           FROM employee_hub.cleanliness_audits a JOIN employee_hub.employees e ON e.id = a.employee_id
          WHERE ${companies === null ? "TRUE" : "e.company_id = ANY($1::uuid[])"}
          GROUP BY a.week_start ORDER BY a.week_start`,
        companies === null ? [] : [companies],
      );
      send(res, { week, currentWeek: auditWeekStart(), ptoWeek: mondayOf(ptoWeekForAuditWeek(week)), people, trend: trend.rows });
    } catch (err) {
      fail(res, 500, `Could not load the report: ${(err as Error).message}`);
    }
  });
}
