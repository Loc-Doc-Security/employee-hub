/**
 * Bonus payouts (formula and steps: see migration 018 and src/lib/bonusMath.ts). Bonus Admins only,
 * for their own company; one role covers the whole process.
 *
 *   GET  /api/bonus?month=YYYY-MM          the month's pool and saved run (if any), and months with history
 *   PUT  /api/bonus/pool                   { month, amount }
 *   GET  /api/bonus/generate?month=        fresh numbers for every eligible person (needs a pool)
 *   POST /api/bonus/run                    { month, basis: fresh|saved, rows: [{ employeeId, profitability, status }] }
 *                                          every person must be confirmed or excluded; replaces the month's run
 *   GET  /api/bonus/export?month=          the saved run for payroll, every active employee listed
 *
 * The server recalculates everything on save from its own numbers; the page only sends the review
 * decisions (profitability and confirm/exclude). Editing a saved month keeps that month's
 * reliability and tenure numbers (basis "saved") instead of pulling fresh ones.
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { canAnywhereIn, type Access } from "../auth/permissions";
import { currentMonthStart } from "../lib/weeks";
import { CRITERIA, RELIABILITY_WINDOW_DAYS, computeBonus, reliabilityOf, tenureYears, type BonusInput } from "../../src/lib/bonusMath";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });
const monthOf = (v: unknown) => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.trim()) ? `${v.trim()}-01` : null);

type Raw = { employeeId: string; name: string; team: string; reliability: number; hasAssessments: boolean;
  breakdown: Record<string, number> | null; assessmentCount: number; tenure: number; hasHireDate: boolean; hiredOn: string | null };

/** Fresh reliability and tenure for every active, bonus-eligible employee in the company. */
async function freshNumbers(companyId: string): Promise<Raw[]> {
  const db = getProductDb();
  const people = (await db.query(
    `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.hired_on::text AS hired_on,
            coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                      JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id), 'No team') AS team
       FROM employee_hub.employees e
      WHERE e.company_id = $1 AND e.is_active AND e.is_bonus_eligible
      ORDER BY e.last_name, e.first_name`, [companyId])).rows;
  const assessments = (await db.query(
    `SELECT subject_id, ${CRITERIA.join(", ")} FROM employee_hub.peer_assessments
      WHERE subject_id = ANY($1::uuid[]) AND created_at >= now() - make_interval(days => $2)`,
    [people.map((p) => p.id), RELIABILITY_WINDOW_DAYS])).rows;
  const today = new Date();
  return people.map((p) => {
    const mine = assessments.filter((a) => a.subject_id === p.id);
    const rel = reliabilityOf(mine);
    const tenure = tenureYears(p.hired_on, today);
    return {
      employeeId: p.id, name: p.name, team: p.team,
      reliability: rel.score ?? 0, hasAssessments: rel.score !== null, breakdown: rel.breakdown, assessmentCount: mine.length,
      tenure: tenure ?? 0, hasHireDate: tenure !== null, hiredOn: p.hired_on,
    };
  });
}

async function savedRun(companyId: string, month: string) {
  const db = getProductDb();
  const run = (await db.query(
    `SELECT r.id, r.pool_amount::float AS pool, r.saved_at, coalesce(e.first_name || ' ' || e.last_name, r.saved_by_name) AS saved_by
       FROM employee_hub.bonus_runs r LEFT JOIN employee_hub.employees e ON e.id = r.saved_by_id
      WHERE r.company_id = $1 AND r.month = $2`, [companyId, month])).rows[0];
  if (!run) return null;
  const rows = (await db.query(
    `SELECT employee_id, employee_name, team, reliability_score::float AS reliability, profitability_score AS profitability,
            tenure_years::float AS tenure, suggested_bonus::float AS suggested, status, payout
       FROM employee_hub.bonus_payouts WHERE run_id = $1 ORDER BY team, employee_name`, [run.id])).rows;
  return { pool: run.pool, savedAt: run.saved_at, savedBy: run.saved_by, rows };
}

async function pool(companyId: string, month: string) {
  return (await getProductDb().query(
    `SELECT p.amount::float AS amount, p.set_at, coalesce(e.first_name || ' ' || e.last_name, p.set_by_name) AS set_by
       FROM employee_hub.bonus_pools p LEFT JOIN employee_hub.employees e ON e.id = p.set_by_id
      WHERE p.company_id = $1 AND p.month = $2`, [companyId, month])).rows[0] ?? null;
}

export function registerBonusRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const admin = async (req: express.Request, res: express.Response): Promise<Access | undefined> => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    const access = current.access;
    if (!access) return void fail(res, 403, "No employee profile for this account");
    if (!canAnywhereIn(access, "bonus.manage", access.companyId)) return void fail(res, 403, "Bonus Admins only");
    return access;
  };

  app.get("/api/bonus", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const month = monthOf(req.query.month) ?? currentMonthStart();
      const history = (await getProductDb().query(
        `SELECT to_char(month, 'YYYY-MM') AS m FROM employee_hub.bonus_runs WHERE company_id = $1
         UNION SELECT to_char(month, 'YYYY-MM') FROM employee_hub.bonus_pools WHERE company_id = $1 ORDER BY 1 DESC`,
        [access.companyId])).rows.map((r) => r.m as string);
      send(res, { month: month.slice(0, 7), current: currentMonthStart().slice(0, 7), history,
        pool: await pool(access.companyId, month), run: await savedRun(access.companyId, month) });
    } catch (err) {
      fail(res, 500, `Could not load bonuses: ${(err as Error).message}`);
    }
  });

  app.put("/api/bonus/pool", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const month = monthOf(req.body?.month);
      const amount = Math.round(Number(req.body?.amount) * 100) / 100;
      if (!month) return void fail(res, 400, "Pick a month.");
      if (!(amount > 0) || amount > 10_000_000) return void fail(res, 400, "Enter a bonus pool greater than $0.");
      const db = getProductDb();
      const before = await pool(access.companyId, month);
      await db.query(
        `INSERT INTO employee_hub.bonus_pools (company_id, month, amount, set_by_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (company_id, month) DO UPDATE SET amount = EXCLUDED.amount, set_by_id = EXCLUDED.set_by_id, set_by_name = NULL, set_at = now()`,
        [access.companyId, month, amount, access.employeeId]);
      await db.query(
        `INSERT INTO employee_hub.admin_activity (company_id, actor_id, action, target_type, summary, before, after)
         VALUES ($1,$2,'bonus.pool','bonus',$3,$4,$5)`,
        [access.companyId, access.employeeId, `Set the ${month.slice(0, 7)} bonus pool to $${amount.toFixed(2)}`,
         before ? JSON.stringify({ amount: before.amount }) : null, JSON.stringify({ amount })]);
      send(res, await pool(access.companyId, month));
    } catch (err) {
      fail(res, 500, `Could not save the pool: ${(err as Error).message}`);
    }
  });

  app.get("/api/bonus/generate", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const month = monthOf(req.query.month);
      if (!month) return void fail(res, 400, "Pick a month.");
      const p = await pool(access.companyId, month);
      if (!p) return void fail(res, 400, `No bonus pool has been set for ${month.slice(0, 7)} yet. Set one first.`);
      send(res, { pool: p.amount, rows: await freshNumbers(access.companyId) });
    } catch (err) {
      fail(res, 500, `Could not generate payouts: ${(err as Error).message}`);
    }
  });

  app.post("/api/bonus/run", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const b = req.body ?? {};
      const month = monthOf(b.month);
      if (!month) return void fail(res, 400, "Pick a month.");
      const p = await pool(access.companyId, month);
      if (!p) return void fail(res, 400, "Set the bonus pool first.");
      const decisions = new Map<string, { profitability: number; status: string }>(
        (Array.isArray(b.rows) ? b.rows : []).map((r: Record<string, unknown>) => [String(r.employeeId), { profitability: Number(r.profitability), status: String(r.status) }]));

      // The people and their reliability/tenure come from the server, never from the page.
      const saved = b.basis === "saved" ? await savedRun(access.companyId, month) : null;
      if (b.basis === "saved" && !saved) return void fail(res, 409, "There's no saved run to edit for that month anymore. Generate it again.");
      const base = saved
        ? saved.rows.map((r) => ({ employeeId: r.employee_id as string, name: r.employee_name as string, team: r.team as string, reliability: r.reliability as number, tenure: r.tenure as number }))
        : (await freshNumbers(access.companyId)).map((r) => ({ employeeId: r.employeeId, name: r.name, team: r.team, reliability: r.reliability, tenure: r.tenure }));

      const inputs: (BonusInput & { name: string; team: string })[] = [];
      for (const person of base) {
        const d = decisions.get(person.employeeId);
        if (!d || (d.status !== "confirmed" && d.status !== "excluded")) return void fail(res, 400, `Confirm or exclude everyone before saving (${person.name} isn't marked). If people were added or became eligible, generate again.`);
        if (![2, 3, 4].includes(d.profitability)) return void fail(res, 400, `Profitability for ${person.name} must be 2, 3 or 4.`);
        inputs.push({ ...person, profitability: d.profitability, status: d.status });
      }
      const pool$ = saved ? saved.pool : p.amount;
      const lines = computeBonus(inputs, pool$);

      const db = getProductDb();
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM employee_hub.bonus_runs WHERE company_id = $1 AND month = $2", [access.companyId, month]);
        const runId = (await client.query(
          "INSERT INTO employee_hub.bonus_runs (company_id, month, pool_amount, saved_by_id) VALUES ($1,$2,$3,$4) RETURNING id",
          [access.companyId, month, pool$, access.employeeId])).rows[0].id;
        for (const [i, l] of lines.entries()) {
          await client.query(
            `INSERT INTO employee_hub.bonus_payouts (run_id, employee_id, employee_name, team, reliability_score, reliability_share,
               profitability_score, profitability_share, tenure_years, tenure_share, suggested_bonus, status, payout)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [runId, l.employeeId, inputs[i].name, inputs[i].team, l.reliability, l.reliabilityShare, l.profitability, l.profitabilityShare,
             l.tenure, l.tenureShare, Math.round(l.suggested * 100) / 100, l.status, l.payout]);
        }
        const total = lines.reduce((s, l) => s + (l.payout ?? 0), 0);
        await client.query(
          `INSERT INTO employee_hub.admin_activity (company_id, actor_id, action, target_type, target_id, summary)
           VALUES ($1,$2,'bonus.run','bonus',$3,$4)`,
          [access.companyId, access.employeeId, runId, `Saved the ${month.slice(0, 7)} bonus run: ${lines.filter((l) => l.status === "confirmed").length} paid, $${total} total`]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      send(res, await savedRun(access.companyId, month));
    } catch (err) {
      fail(res, 500, `Could not save the run: ${(err as Error).message}`);
    }
  });

  app.get("/api/bonus/export", async (req, res) => {
    try {
      const access = await admin(req, res);
      if (!access) return;
      const month = monthOf(req.query.month);
      if (!month) return void fail(res, 400, "Pick a month.");
      const run = await savedRun(access.companyId, month);
      if (!run) return void fail(res, 404, "Nothing has been saved for that month yet.");
      // Every active employee, so payroll sees who wasn't in the run at all (not eligible, new, …).
      const { rows } = await getProductDb().query(
        `SELECT e.id, e.first_name, e.last_name,
                coalesce((SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id WHERE ed.employee_id = e.id), '') AS team
           FROM employee_hub.employees e
          WHERE e.company_id = $1 AND (e.is_active OR e.id = ANY($2::uuid[]))
          ORDER BY e.last_name, e.first_name`, [access.companyId, run.rows.map((r) => r.employee_id)]);
      const byId = new Map(run.rows.map((r) => [r.employee_id as string, r]));
      send(res, {
        month: month.slice(0, 7),
        rows: rows.map((e) => {
          const r = byId.get(e.id);
          return { firstName: e.first_name, lastName: e.last_name, team: r?.team ?? e.team,
            status: r ? (r.status === "confirmed" ? "Confirmed" : "Excluded") : "Not included in run", payout: r?.payout ?? 0 };
        }),
      });
    } catch (err) {
      fail(res, 500, `Could not export: ${(err as Error).message}`);
    }
  });
}
