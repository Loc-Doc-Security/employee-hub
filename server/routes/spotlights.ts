/**
 * Tech Spotlight API. Rules (Levi, 2026-10-16):
 *   - The scheduled presenter of an upcoming meeting files it; free editing (drafts autosave)
 *     through the end of meeting day, locked after.
 *   - Super admin only (spotlights.file_for_anyone): file or edit for anyone, any date, any time.
 *   - Showcase: anyone in the company browses spotlights once presented.
 *
 *   GET /api/spotlights/mine                    my next scheduled meeting, my spotlight for it, my past ones
 *   GET /api/spotlights/for?employeeId=&date=   super admin: load any tech's spotlight for a Wednesday
 *   PUT /api/spotlights                         save { title, problem, solution, slidesUrl, photos, submit }
 *                                               (+ employeeId/date for the super admin override)
 *   GET /api/spotlights/showcase                presented spotlights, newest first
 *   GET /api/spotlights/meeting?date=           meetings.manage: the submitted spotlight(s) for a meeting (deck)
 */
import type express from "express";
import type pg from "pg";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { canAnywhereIn, type Access } from "../auth/permissions";
import { localDate } from "../lib/weeks";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

const COLUMNS = `s.id, s.employee_id, s.presented_on::text AS presented_on, s.title, s.problem, s.solution, s.slides_url,
  s.photos, s.status, s.submitted_at, s.updated_at, e.first_name || ' ' || e.last_name AS presenter`;

const isSuper = (access: Access) => canAnywhereIn(access, "spotlights.file_for_anyone", access.companyId);

/** The next meeting (today or later) where this person is the picked presenter. */
async function nextScheduled(db: pg.Pool, employeeId: string, today: string) {
  return (await db.query(
    `SELECT id, meeting_on::text AS date, topic FROM employee_hub.weekly_meetings
      WHERE presenter_id = $1 AND meeting_on >= $2 ORDER BY meeting_on LIMIT 1`, [employeeId, today])).rows[0] ?? null;
}

async function load(db: pg.Pool, employeeId: string, date: string) {
  return (await db.query(
    `SELECT ${COLUMNS} FROM employee_hub.tech_spotlights s JOIN employee_hub.employees e ON e.id = s.employee_id
      WHERE s.employee_id = $1 AND s.presented_on = $2`, [employeeId, date])).rows[0] ?? null;
}

export function registerSpotlightRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };

  app.get("/api/spotlights/mine", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const db = getProductDb();
      const today = localDate(new Date());
      const meeting = await nextScheduled(db, access.employeeId, today);
      const spotlight = meeting ? await load(db, access.employeeId, meeting.date) : null;
      const past = (await db.query(
        `SELECT ${COLUMNS} FROM employee_hub.tech_spotlights s JOIN employee_hub.employees e ON e.id = s.employee_id
          WHERE s.employee_id = $1 AND s.presented_on < $2 ORDER BY s.presented_on DESC`, [access.employeeId, today])).rows;
      send(res, { today, meeting, spotlight, past, canFileForAnyone: isSuper(access) });
    } catch (err) {
      fail(res, 500, `Could not load your spotlight: ${(err as Error).message}`);
    }
  });

  app.get("/api/spotlights/for", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      if (!isSuper(access)) return void fail(res, 403, "Super admin only");
      const employeeId = String(req.query.employeeId ?? "");
      const date = String(req.query.date ?? "");
      const db = getProductDb();
      const people = (await db.query(
        `SELECT id, first_name || ' ' || last_name AS name FROM employee_hub.employees WHERE company_id = $1 AND is_active ORDER BY last_name, first_name`,
        [access.companyId])).rows;
      // No tech picked yet: just the people to choose from.
      if (!employeeId && !date) return void send(res, { spotlight: null, people });
      if (!/^[0-9a-f-]{36}$/i.test(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return void fail(res, 400, "Pick a tech and a date.");
      send(res, { spotlight: await load(db, employeeId, date), people });
    } catch (err) {
      fail(res, 500, `Could not load the spotlight: ${(err as Error).message}`);
    }
  });

  app.put("/api/spotlights", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const b = req.body ?? {};
      const db = getProductDb();
      const today = localDate(new Date());
      const onBehalf = typeof b.employeeId === "string" && b.employeeId && b.employeeId !== access.employeeId;

      let employeeId = access.employeeId;
      let date: string;
      let meetingId: string | null = null;
      let enteredBy: string | null = null;
      if (onBehalf || (isSuper(access) && typeof b.date === "string")) {
        if (!isSuper(access)) return void fail(res, 403, "Only a super admin can file a spotlight for someone else.");
        employeeId = onBehalf ? b.employeeId : access.employeeId;
        date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : "";
        if (!date) return void fail(res, 400, "Pick the meeting date.");
        const emp = await db.query("SELECT 1 FROM employee_hub.employees WHERE id = $1 AND company_id = $2", [employeeId, access.companyId]);
        if (!emp.rows.length) return void fail(res, 404, "Employee not found.");
        meetingId = (await db.query("SELECT id FROM employee_hub.weekly_meetings WHERE company_id = $1 AND meeting_on = $2", [access.companyId, date])).rows[0]?.id ?? null;
        if (onBehalf) enteredBy = access.employeeId;
      } else {
        const meeting = await nextScheduled(db, access.employeeId, today);
        if (!meeting) return void fail(res, 403, "You're not scheduled to present at an upcoming meeting. Ask your manager to add you to the schedule.");
        date = meeting.date;
        meetingId = meeting.id;
      }
      // Locked after meeting day (super admins excepted).
      if (date < today && !isSuper(access)) return void fail(res, 423, "This spotlight was presented and can't be changed anymore.");

      const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const slides = str(b.slidesUrl, 1000);
      if (slides && !/^https:\/\/\S+$/.test(slides)) return void fail(res, 400, "The slides link must start with https://");
      const photosIn = Array.isArray(b.photos) ? b.photos.slice(0, 20) : [];
      const ids = photosIn.map((p: { uploadId?: unknown }) => String(p?.uploadId ?? "")).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id));
      const valid = ids.length ? new Set((await db.query(
        "SELECT id FROM employee_hub.uploads WHERE id = ANY($1::uuid[]) AND company_id = $2 AND purpose = 'spotlight'",
        [ids, access.companyId])).rows.map((r) => r.id as string)) : new Set<string>();
      const photos = photosIn
        .map((p: { uploadId?: unknown; caption?: unknown }) => ({ uploadId: String(p?.uploadId ?? ""), caption: str(p?.caption, 300) }))
        .filter((p: { uploadId: string }) => valid.has(p.uploadId));

      const title = str(b.title, 200), problem = str(b.problem, 5000), solution = str(b.solution, 5000);
      const submit = b.submit === true;
      if (submit && (!title || !problem || !solution)) return void fail(res, 400, "A title, the problem and the solution are needed to submit.");

      // Once submitted, autosaves keep it submitted (edits stay live until the meeting).
      await db.query(
        `INSERT INTO employee_hub.tech_spotlights (company_id, employee_id, presented_on, meeting_id, title, problem, solution,
           slides_url, photos, status, submitted_at, entered_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10 THEN 'submitted' ELSE 'draft' END, CASE WHEN $10 THEN now() END, $11)
         ON CONFLICT (employee_id, presented_on) DO UPDATE SET
           meeting_id = coalesce(EXCLUDED.meeting_id, employee_hub.tech_spotlights.meeting_id),
           title = EXCLUDED.title, problem = EXCLUDED.problem, solution = EXCLUDED.solution,
           slides_url = EXCLUDED.slides_url, photos = EXCLUDED.photos,
           status = CASE WHEN $10 OR employee_hub.tech_spotlights.status = 'submitted' THEN 'submitted' ELSE 'draft' END,
           submitted_at = CASE WHEN $10 AND employee_hub.tech_spotlights.submitted_at IS NULL THEN now()
                               ELSE employee_hub.tech_spotlights.submitted_at END,
           entered_by_id = coalesce(EXCLUDED.entered_by_id, employee_hub.tech_spotlights.entered_by_id),
           updated_at = now()`,
        [access.companyId, employeeId, date, meetingId, title, problem, solution, slides || null, JSON.stringify(photos), submit, enteredBy],
      );
      send(res, await load(db, employeeId, date));
    } catch (err) {
      fail(res, 500, `Could not save the spotlight: ${(err as Error).message}`);
    }
  });

  app.get("/api/spotlights/showcase", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const { rows } = await getProductDb().query(
        `SELECT ${COLUMNS} FROM employee_hub.tech_spotlights s JOIN employee_hub.employees e ON e.id = s.employee_id
          WHERE s.company_id = $1 AND s.status = 'submitted' AND s.presented_on <= $2
          ORDER BY s.presented_on DESC`, [access.companyId, localDate(new Date())]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load the showcase: ${(err as Error).message}`);
    }
  });

  app.get("/api/spotlights/meeting", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      if (!canAnywhereIn(access, "meetings.manage", access.companyId)) return void fail(res, 403, "Managers only");
      const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : localDate(new Date());
      const { rows } = await getProductDb().query(
        `SELECT ${COLUMNS} FROM employee_hub.tech_spotlights s JOIN employee_hub.employees e ON e.id = s.employee_id
          WHERE s.company_id = $1 AND s.presented_on = $2 AND s.status = 'submitted' ORDER BY s.submitted_at`,
        [access.companyId, date]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load the meeting's spotlight: ${(err as Error).message}`);
    }
  });
}
