/**
 * Employee directory API (reads the employee_hub tables in the product database).
 *
 *   GET /api/org        companies, departments and branches the caller can see, for filters
 *   GET /api/employees  employees with company, branch, departments and roles
 *                       query: company, department, branch (ids), status = active | inactive | all
 *
 * Read access is `employees.view`: every employee has it for their own company (the People page is
 * a read-only directory for everyone), managers/C-Suite/admins by their scope, super admins
 * everywhere. Also registers /api/me and the Weekly Reports routes, so server.ts needs only this one hook.
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { reach } from "../auth/permissions";
import { registerMeRoutes } from "./me";
import { registerWeeklyReportRoutes } from "./weeklyReports";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

/** SQL condition limiting employees (alias e) to where the caller has employees.view. */
function viewScope(reachable: ReturnType<typeof reach>, args: unknown[]): string {
  if (reachable.all) return "TRUE";
  const parts: string[] = [];
  if (reachable.companyIds.length) {
    args.push(reachable.companyIds);
    parts.push(`e.company_id = ANY($${args.length}::uuid[])`);
  }
  if (reachable.departmentIds.length) {
    args.push(reachable.departmentIds);
    parts.push(`EXISTS (SELECT 1 FROM employee_hub.employee_departments s
                 WHERE s.employee_id = e.id AND s.department_id = ANY($${args.length}::uuid[]))`);
  }
  return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
}

export function registerEmployeeRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  // server.ts calls only this function, so the app's other route groups hang off it.
  registerMeRoutes(app, getAuthUser);
  registerWeeklyReportRoutes(app, getAuthUser);

  const withAccess = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) {
      fail(res, 401, "Sign in required");
      return null;
    }
    const reachable = reach(current.access, "employees.view");
    if (!reachable.all && !reachable.companyIds.length && !reachable.departmentIds.length) {
      fail(res, 403, "No employee profile for this account");
      return null;
    }
    return reachable;
  };

  app.get("/api/org", async (req, res) => {
    try {
      const reachable = await withAccess(req, res);
      if (!reachable) return;
      const db = getProductDb();
      // Companies the caller can see anyone in: company grants, plus the companies of department grants.
      const companies = reachable.all
        ? await db.query("SELECT id, slug, name FROM employee_hub.companies WHERE is_active ORDER BY name")
        : await db.query(
            `SELECT id, slug, name FROM employee_hub.companies
              WHERE is_active AND (id = ANY($1::uuid[])
                 OR id IN (SELECT company_id FROM employee_hub.departments WHERE id = ANY($2::uuid[])))
              ORDER BY name`,
            [reachable.companyIds, reachable.departmentIds],
          );
      const ids = companies.rows.map((c) => c.id);
      const [departments, branches] = await Promise.all([
        db.query("SELECT id, company_id, name FROM employee_hub.departments WHERE is_active AND company_id = ANY($1::uuid[]) ORDER BY name", [ids]),
        db.query("SELECT id, company_id, name FROM employee_hub.branches WHERE is_active AND company_id = ANY($1::uuid[]) ORDER BY name", [ids]),
      ]);
      send(res, { companies: companies.rows, departments: departments.rows, branches: branches.rows });
    } catch (err) {
      fail(res, 500, `Could not load org data: ${(err as Error).message}`);
    }
  });

  app.get("/api/employees", async (req, res) => {
    try {
      const reachable = await withAccess(req, res);
      if (!reachable) return;
      const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string).trim() : "");
      const args: unknown[] = [];
      const where = [viewScope(reachable, args)];
      const add = (sql: string, v: unknown) => {
        args.push(v);
        where.push(sql.replace("?", `$${args.length}`));
      };
      if (q("company")) add("e.company_id = ?", q("company"));
      if (q("branch")) add("e.branch_id = ?", q("branch"));
      if (q("department")) {
        add("EXISTS (SELECT 1 FROM employee_hub.employee_departments x WHERE x.employee_id = e.id AND x.department_id = ?)", q("department"));
      }
      const status = q("status") || "active";
      if (status === "active") where.push("e.is_active");
      else if (status === "inactive") where.push("NOT e.is_active");

      const { rows } = await getProductDb().query(
        `SELECT e.id, e.first_name, e.last_name, e.email, e.title, e.phone, e.photo_url, e.employee_type,
                e.vehicle_number, e.is_active, e.hired_on,
                c.name AS company, b.name AS branch,
                coalesce((SELECT array_agg(d.name ORDER BY d.name) FROM employee_hub.employee_departments ed
                          JOIN employee_hub.departments d ON d.id = ed.department_id
                          WHERE ed.employee_id = e.id), '{}') AS departments,
                coalesce((SELECT array_agg(DISTINCT r.name) FROM employee_hub.role_assignments ra
                          JOIN employee_hub.roles r ON r.id = ra.role_id
                          WHERE ra.employee_id = e.id), '{}') AS roles
         FROM employee_hub.employees e
         JOIN employee_hub.companies c ON c.id = e.company_id
         LEFT JOIN employee_hub.branches b ON b.id = e.branch_id
         WHERE ${where.join(" AND ")}
         ORDER BY e.last_name, e.first_name`,
        args,
      );
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load employees: ${(err as Error).message}`);
    }
  });
}
