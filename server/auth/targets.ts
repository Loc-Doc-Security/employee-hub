// "What is this action about?" for can() checks on another employee: their company + departments.
import { getProductDb } from "../db/client";
import type { Target } from "./permissions";

export async function employeeTarget(employeeId: string): Promise<(Target & { isActive: boolean }) | null> {
  const { rows } = await getProductDb().query(
    `SELECT e.company_id, e.is_active,
            coalesce(array_agg(ed.department_id) FILTER (WHERE ed.department_id IS NOT NULL), '{}') AS department_ids
       FROM employee_hub.employees e
       LEFT JOIN employee_hub.employee_departments ed ON ed.employee_id = e.id
      WHERE e.id = $1
      GROUP BY e.id`,
    [employeeId],
  );
  if (!rows.length) return null;
  return { companyId: rows[0].company_id, departmentIds: rows[0].department_ids, isActive: rows[0].is_active };
}
