/**
 * Peer Assessments API.
 *
 *   GET  /api/peer-assessments/assignments      my "My Team" list for this month (created on first visit) + done/not
 *   POST /api/peer-assessments                  assess any active teammate in my company (once a month each; no edits)
 *   GET  /api/peer-assessments/received?month=  me: averages + feedback text, NEVER who wrote it
 *   GET  /api/peer-assessments/team?month=      managers: averages for people in scope. No feedback, no names
 *   GET  /api/peer-assessments/all?month=       C-Suite only (see_authors): every assessment with names
 *
 * Anonymity is enforced here, not in the page: the received and team queries never select the
 * submitter or (for team) the feedback columns.
 */
import type express from "express";
import type pg from "pg";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { reach, type Access } from "../auth/permissions";
import { currentMonthStart } from "../lib/weeks";
import { pickAssignments } from "../lib/peerAssignments";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export const CRITERIA = ["humble", "hungry", "smart", "helpful_kind", "fast_response", "solves_problems"] as const;
const AVG_COLUMNS = CRITERIA.map((c) => `round(avg(${c})::numeric, 2)::float AS ${c}`).join(", ");

function monthParam(req: express.Request): string {
  const m = typeof req.query.month === "string" ? req.query.month.trim() : "";
  return /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : /^\d{4}-\d{2}-\d{2}$/.test(m) ? `${m.slice(0, 7)}-01` : currentMonthStart();
}

/** The assessor's fixed list for a month; computed and stored on first request. */
async function ensureAssignments(db: pg.Pool, access: Access, month: string) {
  const existing = await db.query(
    "SELECT subject_id, reason FROM employee_hub.peer_assessment_assignments WHERE assessor_id = $1 AND month = $2",
    [access.employeeId, month],
  );
  if (existing.rows.length) return existing.rows as { subject_id: string; reason: string }[];

  const { rows } = await db.query(
    `SELECT e.id, coalesce(array_agg(ed.department_id) FILTER (WHERE ed.department_id IS NOT NULL), '{}') AS department_ids
       FROM employee_hub.employees e
       LEFT JOIN employee_hub.employee_departments ed ON ed.employee_id = e.id
      WHERE e.is_active AND e.company_id = $1
      GROUP BY e.id`,
    [access.companyId],
  );
  const me = rows.find((r) => r.id === access.employeeId);
  const picks = pickAssignments(
    access.employeeId, me?.department_ids ?? [],
    rows.map((r) => ({ id: r.id, departmentIds: r.department_ids })), month,
  );
  for (const p of picks) {
    await db.query(
      `INSERT INTO employee_hub.peer_assessment_assignments (company_id, month, assessor_id, subject_id, reason)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [access.companyId, month, access.employeeId, p.subjectId, p.reason],
    );
  }
  return picks.map((p) => ({ subject_id: p.subjectId, reason: p.reason }));
}

export function registerPeerAssessmentRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };

  app.get("/api/peer-assessments/assignments", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const db = getProductDb();
      const month = currentMonthStart();
      await ensureAssignments(db, access, month);
      const { rows } = await db.query(
        `SELECT a.subject_id AS id, a.reason, e.first_name || ' ' || e.last_name AS name,
                coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id), '') AS departments,
                EXISTS (SELECT 1 FROM employee_hub.peer_assessments p
                         WHERE p.submitted_by_id = a.assessor_id AND p.subject_id = a.subject_id AND p.month = a.month) AS done
           FROM employee_hub.peer_assessment_assignments a
           JOIN employee_hub.employees e ON e.id = a.subject_id
          WHERE a.assessor_id = $1 AND a.month = $2
          ORDER BY a.reason, e.last_name, e.first_name`,
        [access.employeeId, month],
      );
      // Everyone I've assessed this month, on the list or not, so search results can show ✓ Done.
      const done = await db.query(
        "SELECT subject_id FROM employee_hub.peer_assessments WHERE submitted_by_id = $1 AND month = $2",
        [access.employeeId, month],
      );
      send(res, { month, people: rows, doneIds: done.rows.map((r) => r.subject_id) });
    } catch (err) {
      fail(res, 500, `Could not load your list: ${(err as Error).message}`);
    }
  });

  app.post("/api/peer-assessments", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const b = req.body ?? {};
      const subjectId = typeof b.subjectId === "string" ? b.subjectId : "";
      const scores: Record<string, number> = {};
      for (const c of CRITERIA) {
        const v = b.scores?.[c];
        if (!Number.isInteger(v) || v < 1 || v > 4) return void fail(res, 400, "Every criterion needs a score from 1 to 4.");
        scores[c] = v;
      }
      const notes: Record<string, string> = {};
      for (const c of CRITERIA) {
        const t = typeof b.criterionFeedback?.[c] === "string" ? b.criterionFeedback[c].trim() : "";
        if ((scores[c] === 1 || scores[c] === 4) && !t) return void fail(res, 400, "Feedback is required for every 1 or 4.");
        if (t) notes[c] = t;
      }
      const general = typeof b.generalFeedback === "string" ? b.generalFeedback.trim() : "";

      // Anyone active in your own company can be assessed (Levi, 2026-10-16): the monthly list is
      // the default "My Team" view, not a limit. Searching outside it is encouraged.
      const db = getProductDb();
      const month = currentMonthStart();
      if (subjectId === access.employeeId) return void fail(res, 400, "You can't assess yourself.");
      const subject = await db.query(
        "SELECT 1 FROM employee_hub.employees WHERE id = $1 AND company_id = $2 AND is_active",
        [subjectId, access.companyId],
      );
      if (!subject.rows.length) return void fail(res, 404, "That person isn't an active teammate in your company.");

      await db.query(
        `INSERT INTO employee_hub.peer_assessments (company_id, month, assessed_on, subject_id, submitted_by_id,
           humble, hungry, smart, helpful_kind, fast_response, solves_problems, criterion_feedback, general_feedback)
         VALUES ($1,$2,(now() AT TIME ZONE 'America/New_York')::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [access.companyId, month, subjectId, access.employeeId, ...CRITERIA.map((c) => scores[c]), JSON.stringify(notes), general],
      );
      send(res, { subjectId });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return void fail(res, 409, "You've already assessed this person this month.");
      fail(res, 500, `Could not save the assessment: ${(err as Error).message}`);
    }
  });

  // The person assessed: averages + feedback. The submitter is never selected.
  app.get("/api/peer-assessments/received", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const db = getProductDb();
      const month = monthParam(req);
      const avg = (await db.query(
        `SELECT count(*)::int AS count, ${AVG_COLUMNS} FROM employee_hub.peer_assessments WHERE subject_id = $1 AND month = $2`,
        [access.employeeId, month],
      )).rows[0];
      const fb = await db.query(
        "SELECT criterion_feedback, general_feedback FROM employee_hub.peer_assessments WHERE subject_id = $1 AND month = $2",
        [access.employeeId, month],
      );
      // Sorted alphabetically, not by date, so the order can't hint at who wrote what.
      const feedback = fb.rows
        .flatMap((r) => [
          ...Object.entries(r.criterion_feedback as Record<string, string>).map(([c, t]) => `${c.replace(/_/g, " ")}: ${t}`),
          ...String(r.general_feedback).split("\n\n"),
        ])
        .map((t) => t.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
      const months = await db.query(
        `SELECT to_char(month, 'YYYY-MM') AS month, count(*)::int AS count, ${AVG_COLUMNS}
           FROM employee_hub.peer_assessments WHERE subject_id = $1 GROUP BY month ORDER BY month`,
        [access.employeeId],
      );
      send(res, { month: month.slice(0, 7), averages: avg, feedback, history: months.rows });
    } catch (err) {
      fail(res, 500, `Could not load your results: ${(err as Error).message}`);
    }
  });

  // Managers: averages only. No feedback and no submitter columns are selected.
  app.get("/api/peer-assessments/team", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const r = reach(access, "reports.view_team");
      if (!r.all && !r.companyIds.length && !r.departmentIds.length) return void fail(res, 403, "Managers only");
      const month = monthParam(req);
      const { rows } = await getProductDb().query(
        `SELECT e.id, e.first_name || ' ' || e.last_name AS name,
                count(p.id)::int AS count, ${CRITERIA.map((c) => `round(avg(p.${c})::numeric, 2)::float AS ${c}`).join(", ")}
           FROM employee_hub.employees e
           LEFT JOIN employee_hub.peer_assessments p ON p.subject_id = e.id AND p.month = $1
          WHERE e.is_active AND ($2 OR e.company_id = ANY($3::uuid[])
                OR EXISTS (SELECT 1 FROM employee_hub.employee_departments s
                            WHERE s.employee_id = e.id AND s.department_id = ANY($4::uuid[])))
          GROUP BY e.id ORDER BY e.last_name, e.first_name`,
        [month, r.all, r.companyIds, r.departmentIds],
      );
      send(res, { month: month.slice(0, 7), people: rows });
    } catch (err) {
      fail(res, 500, `Could not load team results: ${(err as Error).message}`);
    }
  });

  // C-Suite only: everything, including who assessed whom.
  app.get("/api/peer-assessments/all", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const r = reach(access, "peer_assessments.see_authors");
      if (!r.all && !r.companyIds.length) return void fail(res, 403, "Not available for your role");
      const month = monthParam(req);
      const { rows } = await getProductDb().query(
        `SELECT p.id, p.assessed_on::text AS assessed_on,
                coalesce(s.first_name || ' ' || s.last_name, p.subject_former_name) AS subject,
                coalesce(a.first_name || ' ' || a.last_name, p.submitter_former_name, p.submitter_former_email) AS submitted_by,
                ${CRITERIA.join(", ")}, p.criterion_feedback, p.general_feedback
           FROM employee_hub.peer_assessments p
           LEFT JOIN employee_hub.employees s ON s.id = p.subject_id
           LEFT JOIN employee_hub.employees a ON a.id = p.submitted_by_id
          WHERE p.month = $1 AND ($2 OR p.company_id = ANY($3::uuid[]))
          ORDER BY subject, submitted_by`,
        [month, r.all, r.companyIds],
      );
      send(res, { month: month.slice(0, 7), assessments: rows });
    } catch (err) {
      fail(res, 500, `Could not load assessments: ${(err as Error).message}`);
    }
  });
}
