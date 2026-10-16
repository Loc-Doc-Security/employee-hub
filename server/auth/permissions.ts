/**
 * The one permission check for the Employee Hub.
 *
 * A person's access is a list of grants: (permission, scope). Scopes nest:
 *   global      → every company
 *   company     → one company, all its departments
 *   department  → one department in one company
 * Grants come from role_assignments, plus the implicit 'employee' role every active employee holds
 * for their own company.
 *
 * can() is pure (no database) so it's cheap to call anywhere and easy to test exhaustively.
 */
import type pg from "pg";

export type Scope =
  | { type: "global" }
  | { type: "company"; companyId: string }
  | { type: "department"; companyId: string; departmentId: string };

export type Grant = { permission: string; scope: Scope };

export type Access = {
  employeeId: string;
  companyId: string;
  grants: Grant[];
};

/** What an action is about. Omit it to ask "can they do this anywhere at all?" */
export type Target = { companyId: string; departmentIds?: string[] };

export function can(access: Access | null, permission: string, target?: Target): boolean {
  if (!access) return false;
  return access.grants.some((g) => {
    if (g.permission !== permission) return false;
    if (!target) return true;
    switch (g.scope.type) {
      case "global":
        return true;
      case "company":
        return g.scope.companyId === target.companyId;
      case "department": {
        const deptId = g.scope.departmentId;
        return g.scope.companyId === target.companyId && !!target.departmentIds?.includes(deptId);
      }
    }
  });
}

/** Everywhere a permission applies, for filtering lists in SQL. */
export function reach(access: Access | null, permission: string) {
  const grants = access ? access.grants.filter((g) => g.permission === permission) : [];
  return {
    all: grants.some((g) => g.scope.type === "global"),
    companyIds: [...new Set(grants.flatMap((g) => (g.scope.type === "company" ? [g.scope.companyId] : [])))],
    departmentIds: [...new Set(grants.flatMap((g) => (g.scope.type === "department" ? [g.scope.departmentId] : [])))],
  };
}

/** Builds an employee's Access from the database. Null if they don't exist or are inactive. */
export async function loadAccess(db: pg.Pool, employeeId: string): Promise<Access | null> {
  const emp = await db.query(
    "SELECT id, company_id FROM employee_hub.employees WHERE id = $1 AND is_active",
    [employeeId],
  );
  if (!emp.rows.length) return null;
  const companyId: string = emp.rows[0].company_id;

  const { rows } = await db.query(
    `SELECT rp.permission_key, ra.scope_type, ra.company_id, ra.department_id
       FROM employee_hub.role_assignments ra
       JOIN employee_hub.role_permissions rp ON rp.role_id = ra.role_id
      WHERE ra.employee_id = $1
     UNION
     SELECT rp.permission_key, 'company', $2::uuid, NULL
       FROM employee_hub.roles r
       JOIN employee_hub.role_permissions rp ON rp.role_id = r.id
      WHERE r.key = 'employee'`,
    [employeeId, companyId],
  );
  const grants: Grant[] = rows.map((r) => ({
    permission: r.permission_key,
    scope:
      r.scope_type === "global"
        ? { type: "global" }
        : r.scope_type === "company"
          ? { type: "company", companyId: r.company_id }
          : { type: "department", companyId: r.company_id, departmentId: r.department_id },
  }));
  return { employeeId, companyId, grants };
}
