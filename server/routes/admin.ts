/**
 * Admin console API. The Onboarding Admin role is the one gate (Levi, 2026-10-16):
 *   employees.manage  add / edit / deactivate people
 *   roles.grant       grant / remove roles (never Super Admin)
 *   org.manage        departments and branches
 *   system.admin      add a company (super admin only)
 * Every change is written to admin_activity.
 *
 *   GET    /api/admin/people?status=active|inactive|all
 *   GET    /api/admin/options                      companies, departments, branches, grantable roles
 *   POST   /api/admin/people                       add someone (links to OMST on their first sign-in)
 *   PATCH  /api/admin/people/:id                   edit profile fields / departments / active
 *   POST   /api/admin/people/:id/roles             { roleKey, departmentId? } (no departmentId = whole company)
 *   DELETE /api/admin/roles/:assignmentId
 *   POST   /api/admin/departments | /api/admin/branches            { name }
 *   PATCH  /api/admin/departments/:id | /api/admin/branches/:id    { name?, isActive? }
 *   POST   /api/admin/companies                    { name, slug, emailDomains[] }
 *   GET    /api/admin/activity
 */
import type express from "express";
import type pg from "pg";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { canAnywhereIn, type Access } from "../auth/permissions";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });
const UUID = /^[0-9a-f-]{36}$/i;
const NEVER_GRANTABLE = new Set(["super_admin", "employee"]); // employee is implicit for everyone

const PROFILE_FIELDS = {
  firstName: "first_name", lastName: "last_name", title: "title", phone: "phone", employeeType: "employee_type",
  branchId: "branch_id", vehicleNumber: "vehicle_number", vehicleNoun: "vehicle_noun", hasOffice: "has_office",
  isBonusEligible: "is_bonus_eligible", email: "email", hiredOn: "hired_on",
} as const;

async function log(db: pg.Pool | pg.PoolClient, a: { companyId: string | null; actor: string; action: string; targetType: string; targetId?: string | null; summary: string; before?: unknown; after?: unknown }) {
  await db.query(
    `INSERT INTO employee_hub.admin_activity (company_id, actor_id, action, target_type, target_id, summary, before, after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.companyId, a.actor, a.action, a.targetType, a.targetId ?? null, a.summary,
     a.before === undefined ? null : JSON.stringify(a.before), a.after === undefined ? null : JSON.stringify(a.after)]);
}

/** Cleans one profile field from the request; returns undefined when not sent, or throws a message. */
function clean(key: keyof typeof PROFILE_FIELDS, v: unknown): unknown {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : v;
  switch (key) {
    case "firstName": case "lastName":
      if (typeof s !== "string" || !s) throw new Error("First and last name can't be blank.");
      return s.slice(0, 80);
    case "email":
      if (typeof s !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new Error("That email doesn't look right.");
      return s.toLowerCase();
    case "employeeType":
      if (s === "" || s === null) return null;
      if (s !== "office" && s !== "tech") throw new Error("Type must be Office or Tech.");
      return s;
    case "hasOffice": case "isBonusEligible":
      if (typeof s !== "boolean") throw new Error(`${key} must be true or false.`);
      return s;
    case "branchId":
      if (s === "" || s === null) return null;
      if (typeof s !== "string" || !UUID.test(s)) throw new Error("Pick a branch from the list.");
      return s;
    case "hiredOn":
      if (s === "" || s === null) return null;
      if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Hire date must be a date.");
      return s;
    default:
      return s === "" || s === null ? null : String(s).slice(0, 120);
  }
}

export function registerAdminRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const gate = async (req: express.Request, res: express.Response, permission: string, companyId?: string) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    const access = current.access;
    if (!access) return void fail(res, 403, "No employee profile for this account");
    if (!canAnywhereIn(access, permission, companyId ?? access.companyId)) return void fail(res, 403, permission === "system.admin" ? "Super admin only" : "Onboarding Admin only");
    return access;
  };
  const companyOf = async (db: pg.Pool, table: "employees" | "departments" | "branches", id: string) =>
    UUID.test(id) ? ((await db.query(`SELECT company_id FROM employee_hub.${table} WHERE id = $1`, [id])).rows[0]?.company_id as string | undefined) : undefined;

  app.get("/api/admin/people", async (req, res) => {
    try {
      const access = await gate(req, res, "employees.manage");
      if (!access) return;
      const status = String(req.query.status ?? "active");
      const { rows } = await getProductDb().query(
        `SELECT e.id, e.company_id, e.email, e.first_name, e.last_name, e.title, e.phone, e.employee_type, e.branch_id,
                e.vehicle_number, e.vehicle_noun, e.has_office, e.is_bonus_eligible, e.is_active, e.hired_on::text AS hired_on,
                e.omst_user_id IS NOT NULL AS omst_linked,
                coalesce((SELECT array_agg(ed.department_id) FROM employee_hub.employee_departments ed WHERE ed.employee_id = e.id), '{}') AS department_ids,
                coalesce((SELECT json_agg(json_build_object('id', ra.id, 'role', r.key, 'roleName', r.name, 'scope', ra.scope_type,
                                   'departmentId', ra.department_id, 'department', d.name, 'source', ra.source) ORDER BY r.name)
                            FROM employee_hub.role_assignments ra JOIN employee_hub.roles r ON r.id = ra.role_id
                            LEFT JOIN employee_hub.departments d ON d.id = ra.department_id WHERE ra.employee_id = e.id), '[]') AS roles
           FROM employee_hub.employees e
          WHERE e.company_id = $1 AND (${status === "all" ? "TRUE" : status === "inactive" ? "NOT e.is_active" : "e.is_active"})
          ORDER BY e.last_name, e.first_name`, [access.companyId]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load people: ${(err as Error).message}`);
    }
  });

  app.get("/api/admin/options", async (req, res) => {
    try {
      const access = await gate(req, res, "employees.manage");
      if (!access) return;
      const db = getProductDb();
      const [departments, branches, roles, companies] = await Promise.all([
        db.query("SELECT id, name, is_active FROM employee_hub.departments WHERE company_id = $1 ORDER BY name", [access.companyId]),
        db.query("SELECT id, name, is_active FROM employee_hub.branches WHERE company_id = $1 ORDER BY name", [access.companyId]),
        db.query("SELECT key, name, description FROM employee_hub.roles WHERE key <> ALL($1::text[]) ORDER BY name", [[...NEVER_GRANTABLE]]),
        db.query("SELECT id, name, slug, email_domains FROM employee_hub.companies ORDER BY name"),
      ]);
      send(res, {
        companyId: access.companyId, departments: departments.rows, branches: branches.rows, roles: roles.rows,
        companies: companies.rows, canAddCompany: canAnywhereIn(access, "system.admin", access.companyId),
      });
    } catch (err) {
      fail(res, 500, `Could not load options: ${(err as Error).message}`);
    }
  });

  app.post("/api/admin/people", async (req, res) => {
    const db = getProductDb();
    try {
      const access = await gate(req, res, "employees.manage");
      if (!access) return;
      const b = req.body ?? {};
      const fields: Record<string, unknown> = {};
      for (const k of Object.keys(PROFILE_FIELDS) as (keyof typeof PROFILE_FIELDS)[]) {
        const v = clean(k, b[k]);
        if (v !== undefined) fields[PROFILE_FIELDS[k]] = v;
      }
      if (!fields.first_name || !fields.last_name || !fields.email) return void fail(res, 400, "First name, last name and email are required.");
      const dup = await db.query("SELECT first_name || ' ' || last_name AS name FROM employee_hub.employees WHERE lower(email) = $1", [fields.email]);
      if (dup.rows.length) return void fail(res, 409, `${dup.rows[0].name} already has that email.`);
      const cols = Object.keys(fields);
      const { rows } = await db.query(
        `INSERT INTO employee_hub.employees (company_id, ${cols.join(", ")}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
        [access.companyId, ...cols.map((c) => fields[c])]);
      const id = rows[0].id;
      const depts = Array.isArray(b.departmentIds) ? b.departmentIds.filter((d: unknown) => typeof d === "string" && UUID.test(d)) : [];
      for (const d of depts) {
        if ((await companyOf(db, "departments", d)) !== access.companyId) continue;
        await db.query("INSERT INTO employee_hub.employee_departments (employee_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, d]);
      }
      await log(db, { companyId: access.companyId, actor: access.employeeId, action: "employee.create", targetType: "employee", targetId: id,
        summary: `Added ${fields.first_name} ${fields.last_name}`, after: { ...fields, department_ids: depts } });
      send(res, { id });
    } catch (err) {
      fail(res, 400, (err as Error).message);
    }
  });

  app.patch("/api/admin/people/:id", async (req, res) => {
    const db = getProductDb();
    try {
      const companyId = await companyOf(db, "employees", req.params.id);
      if (!companyId) return void fail(res, 404, "Employee not found");
      const access = await gate(req, res, "employees.manage", companyId);
      if (!access) return;
      const before = (await db.query(
        `SELECT e.*, coalesce((SELECT array_agg(department_id) FROM employee_hub.employee_departments WHERE employee_id = e.id), '{}') AS department_ids
           FROM employee_hub.employees e WHERE e.id = $1`, [req.params.id])).rows[0];
      const b = req.body ?? {};
      const fields: Record<string, unknown> = {};
      for (const k of Object.keys(PROFILE_FIELDS) as (keyof typeof PROFILE_FIELDS)[]) {
        const v = clean(k, b[k]);
        if (v !== undefined) fields[PROFILE_FIELDS[k]] = v;
      }
      // Email belongs to OMST once linked: editable only until the first OMST sign-in.
      if ("email" in fields && fields.email !== before.email) {
        if (before.omst_user_id) return void fail(res, 400, "This person is linked to OMST, so their email is managed there.");
        const dup = await db.query("SELECT 1 FROM employee_hub.employees WHERE lower(email) = $1 AND id <> $2", [fields.email, req.params.id]);
        if (dup.rows.length) return void fail(res, 409, "Someone else already has that email.");
      }
      if (typeof b.isActive === "boolean") fields.is_active = b.isActive;
      if ("branch_id" in fields && fields.branch_id && (await companyOf(db, "branches", fields.branch_id as string)) !== companyId) return void fail(res, 400, "Pick a branch from this company.");

      const cols = Object.keys(fields);
      if (cols.length) {
        await db.query(`UPDATE employee_hub.employees SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
          [req.params.id, ...cols.map((c) => fields[c])]);
      }
      let depts: string[] | undefined;
      if (Array.isArray(b.departmentIds)) {
        depts = b.departmentIds.filter((d: unknown) => typeof d === "string" && UUID.test(d));
        const valid = depts!.length ? (await db.query("SELECT id FROM employee_hub.departments WHERE id = ANY($1::uuid[]) AND company_id = $2", [depts, companyId])).rows.map((r) => r.id) : [];
        await db.query("DELETE FROM employee_hub.employee_departments WHERE employee_id = $1", [req.params.id]);
        for (const d of valid) await db.query("INSERT INTO employee_hub.employee_departments (employee_id, department_id) VALUES ($1,$2)", [req.params.id, d]);
        depts = valid;
      }
      const changed = Object.fromEntries(cols.filter((c) => String(before[c] ?? "") !== String(fields[c] ?? "")).map((c) => [c, fields[c]]));
      if (depts) changed.department_ids = depts;
      if (Object.keys(changed).length) {
        const action = "is_active" in changed ? (changed.is_active ? "employee.reactivate" : "employee.deactivate") : "employee.update";
        await log(db, { companyId, actor: access.employeeId, action, targetType: "employee", targetId: req.params.id,
          summary: `${action === "employee.deactivate" ? "Deactivated" : action === "employee.reactivate" ? "Reactivated" : "Updated"} ${before.first_name} ${before.last_name}`,
          before: Object.fromEntries(Object.keys(changed).map((c) => [c, before[c]])), after: changed });
      }
      send(res, { id: req.params.id, changed: Object.keys(changed) });
    } catch (err) {
      fail(res, 400, (err as Error).message);
    }
  });

  app.post("/api/admin/people/:id/roles", async (req, res) => {
    const db = getProductDb();
    try {
      const companyId = await companyOf(db, "employees", req.params.id);
      if (!companyId) return void fail(res, 404, "Employee not found");
      const access = await gate(req, res, "roles.grant", companyId);
      if (!access) return;
      const roleKey = String(req.body?.roleKey ?? "");
      if (NEVER_GRANTABLE.has(roleKey)) return void fail(res, 403, "That role can't be granted from the app.");
      const role = (await db.query("SELECT id, name FROM employee_hub.roles WHERE key = $1", [roleKey])).rows[0];
      if (!role) return void fail(res, 400, "Unknown role.");
      const departmentId = typeof req.body?.departmentId === "string" && req.body.departmentId ? req.body.departmentId : null;
      if (departmentId && (await companyOf(db, "departments", departmentId)) !== companyId) return void fail(res, 400, "Pick a department from this company.");
      const { rows } = await db.query(
        `INSERT INTO employee_hub.role_assignments (employee_id, role_id, scope_type, company_id, department_id, source, granted_by_id)
         VALUES ($1,$2,$3,$4,$5,'manual',$6) ON CONFLICT DO NOTHING RETURNING id`,
        [req.params.id, role.id, departmentId ? "department" : "company", companyId, departmentId, access.employeeId]);
      if (!rows.length) return void fail(res, 409, "They already have that role.");
      const who = (await db.query("SELECT first_name || ' ' || last_name AS n FROM employee_hub.employees WHERE id = $1", [req.params.id])).rows[0].n;
      const dept = departmentId ? (await db.query("SELECT name FROM employee_hub.departments WHERE id = $1", [departmentId])).rows[0].name : null;
      await log(db, { companyId, actor: access.employeeId, action: "role.grant", targetType: "role_assignment", targetId: rows[0].id,
        summary: `Granted ${role.name} to ${who}${dept ? ` (${dept})` : " (whole company)"}`, after: { role: roleKey, departmentId } });
      send(res, { id: rows[0].id });
    } catch (err) {
      fail(res, 500, `Could not grant the role: ${(err as Error).message}`);
    }
  });

  app.delete("/api/admin/roles/:assignmentId", async (req, res) => {
    const db = getProductDb();
    try {
      if (!UUID.test(req.params.assignmentId)) return void fail(res, 404, "Not found");
      const ra = (await db.query(
        `SELECT ra.*, r.key, r.name, e.first_name || ' ' || e.last_name AS who FROM employee_hub.role_assignments ra
           JOIN employee_hub.roles r ON r.id = ra.role_id JOIN employee_hub.employees e ON e.id = ra.employee_id
          WHERE ra.id = $1`, [req.params.assignmentId])).rows[0];
      if (!ra) return void fail(res, 404, "Not found");
      const companyId = ra.company_id ?? (await companyOf(db, "employees", ra.employee_id));
      const access = await gate(req, res, "roles.grant", companyId);
      if (!access) return;
      if (NEVER_GRANTABLE.has(ra.key)) return void fail(res, 403, "That role can't be changed from the app.");
      if (ra.key === "lifecycle_admin" && ra.employee_id === access.employeeId) return void fail(res, 400, "You can't remove your own Onboarding Admin role.");
      await db.query("DELETE FROM employee_hub.role_assignments WHERE id = $1", [req.params.assignmentId]);
      await log(db, { companyId, actor: access.employeeId, action: "role.remove", targetType: "role_assignment", targetId: ra.id,
        summary: `Removed ${ra.name} from ${ra.who}`, before: { role: ra.key, scope: ra.scope_type, departmentId: ra.department_id } });
      send(res, { removed: true });
    } catch (err) {
      fail(res, 500, `Could not remove the role: ${(err as Error).message}`);
    }
  });

  for (const kind of ["departments", "branches"] as const) {
    const label = kind === "departments" ? "department" : "branch";
    app.post(`/api/admin/${kind}`, async (req, res) => {
      const db = getProductDb();
      try {
        const access = await gate(req, res, "org.manage");
        if (!access) return;
        const name = String(req.body?.name ?? "").trim().slice(0, 80);
        if (!name) return void fail(res, 400, `Give the ${label} a name.`);
        const { rows } = await db.query(`INSERT INTO employee_hub.${kind} (company_id, name) VALUES ($1,$2) ON CONFLICT (company_id, name) DO NOTHING RETURNING id`, [access.companyId, name]);
        if (!rows.length) return void fail(res, 409, `There's already a ${label} called ${name}.`);
        await log(db, { companyId: access.companyId, actor: access.employeeId, action: `${label}.create`, targetType: label, targetId: rows[0].id, summary: `Added ${label} ${name}`, after: { name } });
        send(res, { id: rows[0].id });
      } catch (err) {
        fail(res, 500, `Could not add the ${label}: ${(err as Error).message}`);
      }
    });
    app.patch(`/api/admin/${kind}/:id`, async (req, res) => {
      const db = getProductDb();
      try {
        const companyId = await companyOf(db, kind, req.params.id);
        if (!companyId) return void fail(res, 404, "Not found");
        const access = await gate(req, res, "org.manage", companyId);
        if (!access) return;
        const before = (await db.query(`SELECT name, is_active FROM employee_hub.${kind} WHERE id = $1`, [req.params.id])).rows[0];
        const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : before.name;
        const isActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : before.is_active;
        if (!name) return void fail(res, 400, "The name can't be blank.");
        await db.query(`UPDATE employee_hub.${kind} SET name = $2, is_active = $3, updated_at = now() WHERE id = $1`, [req.params.id, name, isActive]);
        await log(db, { companyId, actor: access.employeeId, action: `${label}.update`, targetType: label, targetId: req.params.id,
          summary: `${isActive ? "Updated" : "Retired"} ${label} ${name}`, before, after: { name, is_active: isActive } });
        send(res, { id: req.params.id });
      } catch (err) {
        const dup = (err as { code?: string }).code === "23505";
        fail(res, dup ? 409 : 500, dup ? `There's already a ${label} with that name.` : (err as Error).message);
      }
    });
  }

  app.post("/api/admin/companies", async (req, res) => {
    const db = getProductDb();
    try {
      const access = await gate(req, res, "system.admin");
      if (!access) return;
      const name = String(req.body?.name ?? "").trim();
      const slug = String(req.body?.slug ?? "").trim().toLowerCase();
      const domains = (Array.isArray(req.body?.emailDomains) ? req.body.emailDomains : []).map((d: unknown) => String(d).trim().toLowerCase()).filter(Boolean);
      if (!name || !/^[a-z0-9-]{2,40}$/.test(slug)) return void fail(res, 400, "Give the company a name and a short id (letters, numbers, dashes).");
      const { rows } = await db.query("INSERT INTO employee_hub.companies (name, slug, email_domains) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING RETURNING id", [name, slug, domains]);
      if (!rows.length) return void fail(res, 409, "That company id is taken.");
      await log(db, { companyId: rows[0].id, actor: access.employeeId, action: "company.create", targetType: "company", targetId: rows[0].id, summary: `Added company ${name}`, after: { name, slug, domains } });
      send(res, { id: rows[0].id });
    } catch (err) {
      fail(res, 500, `Could not add the company: ${(err as Error).message}`);
    }
  });

  app.get("/api/admin/activity", async (req, res) => {
    try {
      const access = await gate(req, res, "employees.manage");
      if (!access) return;
      const { rows } = await getProductDb().query(
        `SELECT a.id, a.action, a.summary, a.before, a.after, a.created_at, e.first_name || ' ' || e.last_name AS actor
           FROM employee_hub.admin_activity a JOIN employee_hub.employees e ON e.id = a.actor_id
          WHERE a.company_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [access.companyId]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, `Could not load activity: ${(err as Error).message}`);
    }
  });
}

export type { Access };
