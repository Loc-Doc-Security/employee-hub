/**
 *   GET /api/me   who the request is acting as, and what they can do (the screens use this to
 *                 decide what to show, so anything allowed is reachable and nothing else appears)
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { devViewAsEnabled, resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { reach } from "../auth/permissions";

export function registerMeRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  app.get("/api/me", async (req, res) => {
    try {
      const current = await resolveCurrent(req, getAuthUser);
      if (!current) return void res.status(401).json({ ok: false, error: "Sign in required" });
      const db = getProductDb();
      const access = current.access;

      let employee = null;
      if (access) {
        employee = (await db.query(
          `SELECT e.id, e.first_name, e.last_name, e.email, c.id AS company_id, c.name AS company, c.slug AS company_slug
             FROM employee_hub.employees e JOIN employee_hub.companies c ON c.id = e.company_id
            WHERE e.id = $1`,
          [access.employeeId],
        )).rows[0] ?? null;
      }

      const permissions: Record<string, ReturnType<typeof reach>> = {};
      for (const p of new Set(access?.grants.map((g) => g.permission) ?? [])) permissions[p] = reach(access, p);

      let viewAs = null;
      if (devViewAsEnabled()) {
        const people = await db.query(
          `SELECT e.id, e.first_name || ' ' || e.last_name AS name,
                  coalesce((SELECT string_agg(DISTINCT r.name, ', ') FROM employee_hub.role_assignments ra
                            JOIN employee_hub.roles r ON r.id = ra.role_id WHERE ra.employee_id = e.id), '') AS roles
             FROM employee_hub.employees e WHERE e.is_active ORDER BY e.last_name, e.first_name`,
        );
        viewAs = { active: current.viewingAs, options: people.rows };
      }

      res.json({ ok: true, data: { employee, permissions, viewAs } });
    } catch (err) {
      res.status(500).json({ ok: false, error: `Could not load profile: ${(err as Error).message}` });
    }
  });
}
