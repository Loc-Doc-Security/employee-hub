/**
 * Driver Scorecard API.
 *
 *   POST /api/driver-scorecard/upload           the Geotab PDF (raw body) → parse, match, replace the week
 *   GET  /api/driver-scorecard/weeks            uploaded weeks (newest first)
 *   GET  /api/driver-scorecard/week?week=       one week, whole fleet: rows + rule averages (deck / uploaders)
 *   GET  /api/driver-scorecard/employee/:id     one driver's recent weeks (self, or managers for their people)
 *
 * Matching is by van number (leading zeros ignored); when a number is on both an active and an
 * inactive employee, the active one wins. Parked (left out of rankings, still shown): no activity,
 * no employee match, inactive employee, or PTO for the work week starting inside the report week.
 * Rule averages use every row with a real score, parked or not, so they match Geotab's own printed
 * averages (the Wix rule-average bug, fixed 2026-09-22).
 */
import express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { can, canAnywhereIn } from "../auth/permissions";
import { employeeTarget } from "../auth/targets";
import { parseScorecardPdf, RULE_KEYS } from "../lib/driverScorecardParse";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });
const normVehicle = (v: unknown) => String(v ?? "").trim().replace(/^0+(?=\d)/, "");

const ROW_COLUMNS = `d.id, d.employee_id, d.vehicle_label, d.driver_name_raw, d.group_name, d.classification,
  d.score::float AS score, ${RULE_KEYS.map((k) => `d.${k}_score::float AS ${k}`).join(", ")}, d.is_parked, d.parked_reason,
  coalesce(e.first_name || ' ' || e.last_name, nullif(d.driver_name_raw, '')) AS name`;

export function registerDriverScorecardRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };
  const canSeeFleet = (access: NonNullable<Awaited<ReturnType<typeof me>>>) =>
    canAnywhereIn(access, "meetings.manage", access.companyId) || canAnywhereIn(access, "driver_scorecard.upload", access.companyId);

  app.post("/api/driver-scorecard/upload", express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      if (!canAnywhereIn(access, "driver_scorecard.upload", access.companyId)) return void fail(res, 403, "Scorecard uploaders and managers only");
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return void fail(res, 415, "That file isn't a PDF.");

      let report;
      try {
        report = await parseScorecardPdf(new Uint8Array(bytes));
      } catch (err) {
        return void fail(res, 422, `Couldn't read the scorecard: ${(err as Error).message}`);
      }

      const db = getProductDb();
      const emps = (await db.query(
        "SELECT id, vehicle_number, is_active FROM employee_hub.employees WHERE company_id = $1 AND coalesce(trim(vehicle_number), '') <> ''",
        [access.companyId])).rows;
      const byVehicle = new Map<string, { id: string; is_active: boolean }>();
      for (const e of emps.filter((x) => x.is_active)) byVehicle.set(normVehicle(e.vehicle_number), e);
      for (const e of emps.filter((x) => !x.is_active)) if (!byVehicle.has(normVehicle(e.vehicle_number))) byVehicle.set(normVehicle(e.vehicle_number), e);
      const pto = new Set((await db.query(
        `SELECT employee_id FROM employee_hub.pto_weeks
          WHERE company_id = $1 AND removed_at IS NULL AND week_start BETWEEN $2 AND $3`,
        [access.companyId, report.weekStart, report.weekEnd])).rows.map((r) => r.employee_id as string));

      const counts = { ranked: 0, no_activity: 0, no_employee_match: 0, inactive: 0, pto: 0 };
      const rows = report.rows.map((r) => {
        const emp = byVehicle.get(normVehicle(r.vehicle));
        const reason = r.noActivity ? "no_activity" : !emp ? "no_employee_match" : !emp.is_active ? "inactive" : pto.has(emp.id) ? "pto" : null;
        counts[(reason ?? "ranked") as keyof typeof counts]++;
        return { ...r, employeeId: emp?.id ?? null, reason };
      });

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM employee_hub.driver_score_reports WHERE company_id = $1 AND week_start = $2", [access.companyId, report.weekStart]);
        const reportId = (await client.query(
          `INSERT INTO employee_hub.driver_score_reports (company_id, week_start, week_end, week_label, fleet_score, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [access.companyId, report.weekStart, report.weekEnd, report.weekLabel, report.fleetScore, access.employeeId])).rows[0].id;
        for (const r of rows) {
          await client.query(
            `INSERT INTO employee_hub.driver_scores (report_id, employee_id, vehicle_label, driver_name_raw, group_name, classification, score,
               ${RULE_KEYS.map((k) => `${k}_score`).join(", ")}, is_parked, parked_reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [reportId, r.employeeId, r.vehicle, r.name, r.group, r.classification, r.score, ...r.rules, !!r.reason, r.reason],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      send(res, { weekStart: report.weekStart, weekLabel: report.weekLabel, fleetScore: report.fleetScore, drivers: rows.length, counts });
    } catch (err) {
      fail(res, 500, `Upload failed: ${(err as Error).message}`);
    }
  });

  app.get("/api/driver-scorecard/weeks", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      if (!canSeeFleet(access)) return void fail(res, 403, "Managers and scorecard uploaders only");
      const { rows } = await getProductDb().query(
        `SELECT r.week_start::text AS week_start, r.week_label, r.fleet_score::float AS fleet_score, r.created_at,
                coalesce(u.first_name || ' ' || u.last_name, CASE WHEN r.source = 'wix_import' THEN 'Imported from Wix' END) AS uploaded_by
           FROM employee_hub.driver_score_reports r LEFT JOIN employee_hub.employees u ON u.id = r.uploaded_by_id
          WHERE r.company_id = $1 ORDER BY r.week_start DESC`, [access.companyId]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load weeks: ${(err as Error).message}`);
    }
  });

  app.get("/api/driver-scorecard/week", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      if (!canSeeFleet(access)) return void fail(res, 403, "Managers and scorecard uploaders only");
      const db = getProductDb();
      const week = typeof req.query.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week) ? req.query.week : null;
      const report = (await db.query(
        `SELECT id, week_start::text AS week_start, week_end::text AS week_end, week_label, fleet_score::float AS fleet_score
           FROM employee_hub.driver_score_reports WHERE company_id = $1 ${week ? "AND week_start = $2" : ""}
          ORDER BY week_start DESC LIMIT 1`, week ? [access.companyId, week] : [access.companyId])).rows[0];
      if (!report) return void send(res, null);
      const rows = (await db.query(
        `SELECT ${ROW_COLUMNS} FROM employee_hub.driver_scores d LEFT JOIN employee_hub.employees e ON e.id = d.employee_id
          WHERE d.report_id = $1 ORDER BY d.is_parked, d.score DESC NULLS LAST, d.vehicle_label`, [report.id])).rows;
      const scored = rows.filter((r) => r.score != null);
      const ruleAverages = Object.fromEntries(RULE_KEYS.map((k) => [k, scored.length ? +(scored.reduce((s, r) => s + r[k], 0) / scored.length).toFixed(2) : null]));
      send(res, { ...report, rows, ruleAverages });
    } catch (err) {
      fail(res, 500, `Could not load the scorecard: ${(err as Error).message}`);
    }
  });

  app.get("/api/driver-scorecard/employee/:id", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const id = req.params.id === "me" ? access.employeeId : req.params.id;
      if (id !== access.employeeId) {
        const target = await employeeTarget(id);
        if (!target || !can(access, "reports.view_team", target)) return void fail(res, 403, "Not allowed");
      }
      const { rows } = await getProductDb().query(
        `SELECT r.week_start::text AS week_start, r.week_label, r.fleet_score::float AS fleet_score, ${ROW_COLUMNS}
           FROM employee_hub.driver_scores d
           JOIN employee_hub.driver_score_reports r ON r.id = d.report_id
           LEFT JOIN employee_hub.employees e ON e.id = d.employee_id
          WHERE d.employee_id = $1 ORDER BY r.week_start DESC LIMIT 12`, [id]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load driver scores: ${(err as Error).message}`);
    }
  });
}
