/**
 * Wednesday meeting schedule (meetings.manage: managers, C-Suite, admins).
 *
 *   GET /api/meetings?from=YYYY-MM-DD&weeks=N   meetings from that date (default: this week) + the
 *                                               people who can be picked as presenter
 *   PUT /api/meetings                           create or update one meeting:
 *                                               { date (a Wednesday), topic?, presenterId?,
 *                                                 presentationUrl?, presentationType? }
 *
 * Meetings belong to the caller's own company (a super admin may pass companyId).
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { canAnywhereIn } from "../auth/permissions";
import { localDate, mondayOf } from "../lib/weeks";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

const MEETING_COLUMNS = `w.id, w.meeting_on::text AS date, w.topic, w.presenter_id, w.presenter_name_legacy,
  w.presentation_url, w.presentation_type, p.first_name || ' ' || p.last_name AS presenter`;

export function registerMeetingRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const manager = async (req: express.Request, res: express.Response, companyParam?: unknown) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    const access = current.access;
    if (!access) return void fail(res, 403, "No employee profile for this account");
    const companyId = typeof companyParam === "string" && companyParam ? companyParam : access.companyId;
    if (!canAnywhereIn(access, "meetings.manage", companyId)) return void fail(res, 403, "Managers only");
    return { access, companyId };
  };

  app.get("/api/meetings", async (req, res) => {
    try {
      const ctx = await manager(req, res, req.query.companyId);
      if (!ctx) return;
      const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
        ? req.query.from : mondayOf(localDate(new Date()));
      const weeks = Math.min(104, Math.max(1, Number(req.query.weeks) || 12));
      const db = getProductDb();
      const meetings = await db.query(
        `SELECT ${MEETING_COLUMNS} FROM employee_hub.weekly_meetings w
           LEFT JOIN employee_hub.employees p ON p.id = w.presenter_id
          WHERE w.company_id = $1 AND w.meeting_on >= $2 AND w.meeting_on < ($2::date + $3 * 7)
          ORDER BY w.meeting_on`,
        [ctx.companyId, from, weeks],
      );
      const people = await db.query(
        `SELECT id, first_name || ' ' || last_name AS name FROM employee_hub.employees
          WHERE company_id = $1 AND is_active ORDER BY last_name, first_name`, [ctx.companyId]);
      send(res, { from, weeks, meetings: meetings.rows, people: people.rows });
    } catch (err) {
      fail(res, 500, `Could not load meetings: ${(err as Error).message}`);
    }
  });

  app.put("/api/meetings", async (req, res) => {
    try {
      const b = req.body ?? {};
      const ctx = await manager(req, res, b.companyId);
      if (!ctx) return;
      const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : "";
      if (!date || new Date(`${date}T12:00:00Z`).getUTCDay() !== 3) return void fail(res, 400, "Meetings are on Wednesdays. Pick a Wednesday.");
      const db = getProductDb();

      const topic = typeof b.topic === "string" ? b.topic.trim().slice(0, 300) : undefined;
      let presenterId: string | null | undefined;
      if (b.presenterId === null || b.presenterId === "") presenterId = null;
      else if (typeof b.presenterId === "string") {
        const ok = await db.query("SELECT 1 FROM employee_hub.employees WHERE id = $1 AND company_id = $2 AND is_active", [b.presenterId, ctx.companyId]);
        if (!ok.rows.length) return void fail(res, 400, "Pick an active employee as presenter.");
        presenterId = b.presenterId;
      }
      let url: string | null | undefined;
      if (b.presentationUrl === null || b.presentationUrl === "") url = null;
      else if (typeof b.presentationUrl === "string") {
        const trimmed: string = b.presentationUrl.trim();
        if (!/^https:\/\/\S+$/.test(trimmed)) return void fail(res, 400, "The presentation link must start with https://");
        url = trimmed;
      }
      const type = url === null ? null : b.presentationType === "external" ? "external" : b.presentationType === "slides" ? "slides"
        : url && /docs\.google\.com\/presentation/.test(url) ? "slides" : url ? "external" : undefined;

      // Only the fields that were sent change; picking a presenter clears the old typed name.
      const { rows } = await db.query(
        `INSERT INTO employee_hub.weekly_meetings (company_id, meeting_on, topic, presenter_id, presentation_url, presentation_type, updated_by_id)
         VALUES ($1, $2, coalesce($3, ''), $4, $5, $6, $7)
         ON CONFLICT (company_id, meeting_on) DO UPDATE SET
           topic = CASE WHEN $8 THEN EXCLUDED.topic ELSE employee_hub.weekly_meetings.topic END,
           presenter_id = CASE WHEN $9 THEN EXCLUDED.presenter_id ELSE employee_hub.weekly_meetings.presenter_id END,
           presenter_name_legacy = CASE WHEN $9 THEN NULL ELSE employee_hub.weekly_meetings.presenter_name_legacy END,
           presentation_url = CASE WHEN $10 THEN EXCLUDED.presentation_url ELSE employee_hub.weekly_meetings.presentation_url END,
           presentation_type = CASE WHEN $10 THEN EXCLUDED.presentation_type ELSE employee_hub.weekly_meetings.presentation_type END,
           updated_by_id = EXCLUDED.updated_by_id, updated_at = now()
         RETURNING id`,
        [ctx.companyId, date, topic ?? null, presenterId ?? null, url ?? null, type ?? null, ctx.access.employeeId,
         topic !== undefined, presenterId !== undefined, url !== undefined],
      );
      const saved = await db.query(
        `SELECT ${MEETING_COLUMNS} FROM employee_hub.weekly_meetings w LEFT JOIN employee_hub.employees p ON p.id = w.presenter_id WHERE w.id = $1`,
        [rows[0].id]);
      send(res, saved.rows[0]);
    } catch (err) {
      fail(res, 500, `Could not save the meeting: ${(err as Error).message}`);
    }
  });
}
