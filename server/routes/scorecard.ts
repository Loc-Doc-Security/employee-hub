/**
 * Scorecard API (My Score + Team scores).
 *
 *   GET /api/scorecard/me?month=YYYY-MM            my card
 *   GET /api/scorecard/employee/:id?month=YYYY-MM  someone else's card (managers for their people,
 *                                                  Operations / C-Suite for everyone)
 *   GET /api/scorecard/team?month=YYYY-MM          minimal leaderboard: rank, name, overall, level.
 *                                                  Employees see their own department(s); managers
 *                                                  their scope; Operations / C-Suite everyone.
 *
 * All the math lives in server/lib/scoring.ts. Data for a whole roster is loaded in a handful of
 * queries (never per person).
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { can, reach } from "../auth/permissions";
import { employeeTarget } from "../auth/targets";
import { auditWeekStart, currentMonthStart, currentWeekStart } from "../lib/weeks";
import { badgesFor, levelFor, quarterOf, scoreMonth, streak, type MonthScore } from "../lib/scoring";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export const HISTORY_MONTHS = 13; // enough for a year-long streak plus the current month

export function monthsBack(fromMonth: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${fromMonth}-01T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

export function monthParam(req: express.Request): string {
  const m = typeof req.query.month === "string" ? req.query.month.trim() : "";
  const now = currentMonthStart().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) && m <= now ? m : now;
}

/** Everything needed to score these employees for the given months, in five queries. */
export async function loadScoringData(ids: string[], oldestMonth: string) {
  const db = getProductDb();
  const since = `${oldestMonth}-01`;
  const sinceWeek = new Date(`${since}T12:00:00Z`);
  sinceWeek.setUTCDate(sinceWeek.getUTCDate() - 7);
  const sinceW = sinceWeek.toISOString().slice(0, 10);
  const [weekly, pto, audits, given, received] = await Promise.all([
    db.query("SELECT employee_id, week_start::text AS w FROM employee_hub.weekly_reports WHERE employee_id = ANY($1::uuid[]) AND week_start >= $2", [ids, sinceW]),
    db.query("SELECT employee_id, week_start::text AS w FROM employee_hub.pto_weeks WHERE employee_id = ANY($1::uuid[]) AND removed_at IS NULL AND week_start >= $2", [ids, sinceW]),
    db.query("SELECT employee_id, week_start::text AS w, score FROM employee_hub.cleanliness_audits WHERE employee_id = ANY($1::uuid[]) AND week_start >= $2", [ids, sinceW]),
    db.query(`SELECT submitted_by_id AS employee_id, to_char(month, 'YYYY-MM') AS m, count(*)::int AS n
                FROM employee_hub.peer_assessments WHERE submitted_by_id = ANY($1::uuid[]) AND month >= $2 GROUP BY 1, 2`, [ids, since]),
    db.query(`SELECT subject_id AS employee_id, to_char(month, 'YYYY-MM') AS m,
                     avg((humble + hungry + smart + helpful_kind + fast_response + solves_problems) / 6.0)::float AS avg
                FROM employee_hub.peer_assessments WHERE subject_id = ANY($1::uuid[]) AND month >= $2 GROUP BY 1, 2`, [ids, since]),
  ]);
  const by = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  return {
    weekly: by(weekly.rows, (r) => r.employee_id),
    pto: by(pto.rows, (r) => r.employee_id),
    audits: by(audits.rows, (r) => r.employee_id),
    given: by(given.rows, (r) => `${r.employee_id}|${r.m}`),
    received: by(received.rows, (r) => `${r.employee_id}|${r.m}`),
  };
}

export type ScoringData = Awaited<ReturnType<typeof loadScoringData>>;

export function cardFor(id: string, data: ScoringData, selected: string) {
  const ctx = { currentMonday: currentWeekStart(), currentAuditWeek: auditWeekStart() };
  const weeklyWeeks = new Set((data.weekly.get(id) ?? []).map((r) => r.w as string));
  const ptoWeeks = new Set((data.pto.get(id) ?? []).map((r) => r.w as string));
  const audits = new Map((data.audits.get(id) ?? []).map((r) => [r.w as string, Number(r.score)]));
  const score = (m: string): MonthScore => scoreMonth({
    month: `${m}-01`, ...ctx, weeklyWeeks, ptoWeeks, audits,
    peerSubmitted: data.given.get(`${id}|${m}`)?.[0]?.n ?? 0,
    peerReceivedAvg: data.received.get(`${id}|${m}`)?.[0]?.avg != null ? +Number(data.received.get(`${id}|${m}`)![0].avg).toFixed(2) : null,
  });

  const months = monthsBack(selected, HISTORY_MONTHS).map(score); // newest first
  const current = months[0];
  const q = quarterOf(selected);
  const quarterPoints = q.months.filter((m) => m <= selected).reduce((s, m) => s + score(m).points, 0);
  const streakMonths = streak(months, currentMonthStart().slice(0, 7));
  return {
    ...current, // includes month (YYYY-MM)
    streak: streakMonths,
    badges: badgesFor(current, streakMonths),
    quarter: { label: q.label, points: quarterPoints, level: levelFor(quarterPoints) },
    recent: months.slice(0, 6).map((m) => ({ month: m.month, overall: m.overall, participation: m.participation })),
  };
}

export function registerScorecardRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };

  const one = async (id: string, month: string) => {
    const oldest = monthsBack(month, HISTORY_MONTHS).pop()!;
    const card = cardFor(id, await loadScoringData([id], oldest), month);
    // Driver scores: reference only, not part of the score (Levi, 2026-10-16).
    const driver = (await getProductDb().query(
      `SELECT r.week_label, d.score::float AS score, d.is_parked, r.fleet_score::float AS fleet_score
         FROM employee_hub.driver_scores d JOIN employee_hub.driver_score_reports r ON r.id = d.report_id
        WHERE d.employee_id = $1 AND r.week_start < ($2::date + interval '1 month') ORDER BY r.week_start DESC LIMIT 4`,
      [id, `${month}-01`])).rows;
    return { ...card, driver };
  };

  app.get("/api/scorecard/me", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const r = reach(access, "reports.view_team");
      send(res, { card: await one(access.employeeId, monthParam(req)), canSeeOthers: r.all || r.companyIds.length > 0 || r.departmentIds.length > 0 });
    } catch (err) {
      fail(res, 500, `Could not load your scorecard: ${(err as Error).message}`);
    }
  });

  app.get("/api/scorecard/employee/:id", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const target = await employeeTarget(req.params.id);
      if (!target) return void fail(res, 404, "Employee not found");
      if (req.params.id !== access.employeeId && !can(access, "reports.view_team", target)) return void fail(res, 403, "Not allowed");
      const name = (await getProductDb().query("SELECT first_name || ' ' || last_name AS name FROM employee_hub.employees WHERE id = $1", [req.params.id])).rows[0]?.name;
      send(res, { name, card: await one(req.params.id, monthParam(req)) });
    } catch (err) {
      fail(res, 500, `Could not load the scorecard: ${(err as Error).message}`);
    }
  });

  app.get("/api/scorecard/team", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const month = monthParam(req);
      const r = reach(access, "reports.view_team");
      const managerView = r.all || r.companyIds.length > 0 || r.departmentIds.length > 0;
      // Employees without a team-report role see their own department(s).
      const deptIds = managerView ? r.departmentIds
        : (await getProductDb().query("SELECT department_id FROM employee_hub.employee_departments WHERE employee_id = $1", [access.employeeId])).rows.map((x) => x.department_id);
      const { rows } = await getProductDb().query(
        `SELECT e.id, e.first_name || ' ' || e.last_name AS name FROM employee_hub.employees e
          WHERE e.is_active AND ($1 OR e.company_id = ANY($2::uuid[])
                OR EXISTS (SELECT 1 FROM employee_hub.employee_departments s WHERE s.employee_id = e.id AND s.department_id = ANY($3::uuid[])))
            AND (coalesce(trim(e.vehicle_number), '') <> '' OR e.has_office OR EXISTS (SELECT 1 FROM employee_hub.weekly_reports w WHERE w.employee_id = e.id))`,
        [r.all, managerView ? r.companyIds : [], deptIds],
      );
      if (!rows.length) return void send(res, { month, scope: managerView ? "team" : "department", people: [] });
      const data = await loadScoringData(rows.map((x) => x.id), monthsBack(month, HISTORY_MONTHS).pop()!);
      const people = rows
        .map((p) => {
          const c = cardFor(p.id, data, month);
          return { id: p.id, name: p.name, overall: c.overall, level: c.quarter.level.name, isMe: p.id === access.employeeId };
        })
        .sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name))
        .map((p, i) => ({ rank: i + 1, ...p }));
      send(res, { month, scope: managerView ? "team" : "department", canOpen: managerView, people });
    } catch (err) {
      fail(res, 500, `Could not load team scores: ${(err as Error).message}`);
    }
  });
}
