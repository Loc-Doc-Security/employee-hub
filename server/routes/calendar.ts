/**
 * Calendar (Levi, 2026-10-19). Read-only for everyone in the company; Calendar Admins keep the
 * holidays and events.
 *
 *   GET    /api/calendar?from=&to=              everything dated in that range (at most 100 days):
 *                                               holidays, events, Wednesday meetings (topic, presenter,
 *                                               spotlights), PTO, birthdays, work anniversaries
 *   Calendar Admins (calendar.manage in their company):
 *   GET    /api/calendar/events?year=           the holidays and events they keep
 *   POST   /api/calendar/events                 { kind, title, startsOn, endsOn?, startTime?, endTime?, location?, description?, officeClosed? }
 *   PUT    /api/calendar/events/:id             same fields
 *   DELETE /api/calendar/events/:id
 *   POST   /api/calendar/add-holidays           { year }  the standard holidays on their office-closed days
 *                                               (skips any already there by name)
 *
 * Only active employees appear. Birthdays show the day, never the year.
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { canAnywhereIn, type Access } from "../auth/permissions";
import { addDays, anniversaries, daysBetween, isDate, occurrences, standardHolidays } from "../lib/calendar";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export type CalendarItem = {
  id: string; kind: "holiday" | "event" | "meeting" | "pto" | "birthday" | "anniversary";
  title: string; start: string; end: string; time?: string | null; endTime?: string | null;
  detail?: string | null; location?: string | null; officeClosed?: boolean;
};

const EVENT_COLUMNS = `id, kind, title, starts_on::text AS starts_on, ends_on::text AS ends_on,
  to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time, location, description, office_closed`;

export function registerCalendarRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response): Promise<Access | undefined> => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };
  const admin = async (req: express.Request, res: express.Response) => {
    const access = await me(req, res);
    if (!access) return;
    if (!canAnywhereIn(access, "calendar.manage", access.companyId)) return void fail(res, 403, "Calendar Admins only");
    return access;
  };

  app.get("/api/calendar", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const { from, to } = req.query;
      if (!isDate(from) || !isDate(to) || to < from) return void fail(res, 400, "Send from and to as YYYY-MM-DD.");
      if (daysBetween(from, to) > 100) return void fail(res, 400, "At most 100 days at a time.");
      const db = getProductDb();
      const c = access.companyId;
      const items: CalendarItem[] = [];

      for (const e of (await db.query(
        `SELECT ${EVENT_COLUMNS} FROM employee_hub.calendar_events
          WHERE company_id = $1 AND starts_on <= $3 AND ends_on >= $2 ORDER BY starts_on, start_time NULLS FIRST`, [c, from, to])).rows) {
        items.push({ id: e.id, kind: e.kind, title: e.title, start: e.starts_on, end: e.ends_on, time: e.start_time, endTime: e.end_time,
          detail: e.description, location: e.location, officeClosed: e.office_closed });
      }

      // Every Wednesday has the meeting; the schedule adds topic and presenter, spotlights add who's presenting one.
      const meetings = new Map((await db.query(
        `SELECT m.meeting_on::text AS d, m.topic, coalesce(p.first_name || ' ' || p.last_name, m.presenter_name_legacy) AS presenter
           FROM employee_hub.weekly_meetings m LEFT JOIN employee_hub.employees p ON p.id = m.presenter_id
          WHERE m.company_id = $1 AND m.meeting_on BETWEEN $2 AND $3`, [c, from, to])).rows.map((m) => [m.d as string, m]));
      const spotlights = (await db.query(
        `SELECT s.presented_on::text AS d, e.first_name || ' ' || e.last_name AS name, s.title
           FROM employee_hub.tech_spotlights s JOIN employee_hub.employees e ON e.id = s.employee_id
          WHERE s.company_id = $1 AND s.presented_on BETWEEN $2 AND $3 ORDER BY e.last_name`, [c, from, to])).rows;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (new Date(`${d}T12:00:00Z`).getUTCDay() !== 3) continue;
        const m = meetings.get(d);
        const spot = spotlights.filter((s) => s.d === d);
        const lines = [
          m?.presenter ? `Presenter: ${m.presenter}` : null,
          spot.length ? `Tech Spotlight: ${spot.map((s) => (s.title ? `${s.name} (${s.title})` : s.name)).join(", ")}` : null,
        ].filter(Boolean);
        items.push({ id: `meeting-${d}`, kind: "meeting", title: m?.topic ? `Wednesday Meeting: ${m.topic}` : "Wednesday Meeting", start: d, end: d, detail: lines.join("\n") || null });
      }

      // PTO is marked by week (Monday); show the work week.
      for (const p of (await db.query(
        `SELECT p.week_start::text AS w, e.id, e.first_name || ' ' || e.last_name AS name
           FROM employee_hub.pto_weeks p JOIN employee_hub.employees e ON e.id = p.employee_id
          WHERE e.company_id = $1 AND e.is_active AND p.removed_at IS NULL AND p.week_start BETWEEN $2::date - 6 AND $3
          ORDER BY e.last_name, e.first_name`, [c, from, to])).rows) {
        items.push({ id: `pto-${p.id}-${p.w}`, kind: "pto", title: `${p.name} out`, start: p.w, end: addDays(p.w, 4), detail: "On PTO this week" });
      }

      const people = (await db.query(
        `SELECT id, first_name || ' ' || last_name AS name, birthday_md, hired_on::text AS hired_on
           FROM employee_hub.employees WHERE company_id = $1 AND is_active AND (birthday_md IS NOT NULL OR hired_on IS NOT NULL)`, [c])).rows;
      for (const p of people) {
        if (p.birthday_md) for (const d of occurrences(p.birthday_md, from, to)) items.push({ id: `bday-${p.id}-${d}`, kind: "birthday", title: `${p.name}'s birthday`, start: d, end: d });
        if (p.hired_on) for (const a of anniversaries(p.hired_on, from, to)) {
          items.push({ id: `anniv-${p.id}-${a.date}`, kind: "anniversary", title: `${p.name}: ${a.years} year${a.years === 1 ? "" : "s"}`, start: a.date, end: a.date, detail: "Work anniversary" });
        }
      }

      items.sort((a, b) => a.start.localeCompare(b.start) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
      send(res, { items, canManage: canAnywhereIn(access, "calendar.manage", c) });
    } catch (err) {
      fail(res, 500, `Could not load the calendar: ${(err as Error).message}`);
    }
  });

  app.get("/api/calendar/events", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const year = /^\d{4}$/.test(String(req.query.year)) ? Number(req.query.year) : new Date().getFullYear();
      const { rows } = await getProductDb().query(
        `SELECT ${EVENT_COLUMNS} FROM employee_hub.calendar_events
          WHERE company_id = $1 AND starts_on <= make_date($2, 12, 31) AND ends_on >= make_date($2, 1, 1)
          ORDER BY starts_on, start_time NULLS FIRST`, [access.companyId, year]);
      send(res, { year, events: rows });
    } catch (err) {
      fail(res, 500, `Could not load events: ${(err as Error).message}`);
    }
  });

  /** Validates an event from the request; returns an error message or the clean values. */
  const clean = (b: Record<string, unknown>) => {
    const kind = b.kind === "holiday" ? "holiday" : b.kind === "event" ? "event" : null;
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
    const startsOn = b.startsOn, endsOn = b.endsOn || b.startsOn;
    const time = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
    const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    if (!kind) return "Pick holiday or event.";
    if (!title) return "Give it a title.";
    if (!isDate(startsOn) || !isDate(endsOn) || endsOn < startsOn) return "Check the dates.";
    if (daysBetween(startsOn, endsOn) > 31) return "Events can be at most a month long.";
    const startTime = time(b.startTime), endTime = startTime ? time(b.endTime) : null;
    if (startTime && endTime && startsOn === endsOn && endTime <= startTime) return "The end time is before the start time.";
    return { kind, title, startsOn, endsOn, startTime, endTime, location: text(b.location, 200), description: text(b.description, 2000), officeClosed: kind === "holiday" && b.officeClosed === true };
  };

  const log = (a: Access, action: string, id: string | null, summary: string) => getProductDb().query(
    "INSERT INTO employee_hub.admin_activity (company_id, actor_id, action, target_type, target_id, summary) VALUES ($1,$2,$3,'calendar_event',$4,$5)",
    [a.companyId, a.employeeId, action, id, summary]);

  app.post("/api/calendar/events", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const v = clean(req.body ?? {});
      if (typeof v === "string") return void fail(res, 400, v);
      const { rows } = await getProductDb().query(
        `INSERT INTO employee_hub.calendar_events (company_id, kind, title, starts_on, ends_on, start_time, end_time, location, description, office_closed, created_by_id, updated_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
        [access.companyId, v.kind, v.title, v.startsOn, v.endsOn, v.startTime, v.endTime, v.location, v.description, v.officeClosed, access.employeeId]);
      await log(access, "calendar.add", rows[0].id, `Added the ${v.kind} "${v.title}" (${v.startsOn})`);
      send(res, { id: rows[0].id });
    } catch (err) {
      fail(res, 500, `Could not add the event: ${(err as Error).message}`);
    }
  });

  app.put("/api/calendar/events/:id", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return void fail(res, 404, "Not found");
      const v = clean(req.body ?? {});
      if (typeof v === "string") return void fail(res, 400, v);
      const r = await getProductDb().query(
        `UPDATE employee_hub.calendar_events SET kind = $3, title = $4, starts_on = $5, ends_on = $6, start_time = $7, end_time = $8,
                location = $9, description = $10, office_closed = $11, updated_by_id = $12, updated_at = now()
          WHERE id = $1 AND company_id = $2`,
        [req.params.id, access.companyId, v.kind, v.title, v.startsOn, v.endsOn, v.startTime, v.endTime, v.location, v.description, v.officeClosed, access.employeeId]);
      if (!r.rowCount) return void fail(res, 404, "Not found");
      await log(access, "calendar.update", req.params.id, `Updated the ${v.kind} "${v.title}" (${v.startsOn})`);
      send(res, { id: req.params.id });
    } catch (err) {
      fail(res, 500, `Could not update the event: ${(err as Error).message}`);
    }
  });

  app.delete("/api/calendar/events/:id", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return void fail(res, 404, "Not found");
      const { rows } = await getProductDb().query(
        "DELETE FROM employee_hub.calendar_events WHERE id = $1 AND company_id = $2 RETURNING kind, title, starts_on::text AS d",
        [req.params.id, access.companyId]);
      if (!rows[0]) return void fail(res, 404, "Not found");
      await log(access, "calendar.remove", req.params.id, `Removed the ${rows[0].kind} "${rows[0].title}" (${rows[0].d})`);
      send(res, { removed: true });
    } catch (err) {
      fail(res, 500, `Could not remove the event: ${(err as Error).message}`);
    }
  });

  app.post("/api/calendar/add-holidays", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const year = Number(req.body?.year);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) return void fail(res, 400, "Pick a year.");
      const db = getProductDb();
      const have = new Set((await db.query(
        "SELECT lower(title) AS t FROM employee_hub.calendar_events WHERE company_id = $1 AND kind = 'holiday' AND extract(year FROM starts_on) = $2",
        [access.companyId, year])).rows.map((r) => r.t as string));
      let added = 0;
      for (const h of standardHolidays(year)) {
        if (have.has(h.title.toLowerCase())) continue;
        const note = h.moved ? `Falls on a ${new Date(`${h.actual}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}; the office is closed this day instead.` : null;
        await db.query(
          `INSERT INTO employee_hub.calendar_events (company_id, kind, title, starts_on, ends_on, description, office_closed, created_by_id, updated_by_id)
           VALUES ($1,'holiday',$2,$3,$3,$4,true,$5,$5)`, [access.companyId, h.title, h.date, note, access.employeeId]);
        added++;
      }
      if (added) await log(access, "calendar.holidays", null, `Added ${added} standard holidays for ${year}`);
      send(res, { added, skipped: standardHolidays(year).length - added });
    } catch (err) {
      fail(res, 500, `Could not add holidays: ${(err as Error).message}`);
    }
  });
}
