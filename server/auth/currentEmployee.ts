/**
 * Who is this request acting as?
 *
 * Production: the signed-in user's email (from OMST) → their employee record.
 * Local dev only (NODE_ENV !== production AND LAB_DEV_SIMPLE_AUTH=1): the "View as" picker sends
 * an `x-view-as` header with an employee id, so any role can be tried out and tested. The local
 * admin/admin account isn't an employee, so with no picker choice it acts as the first super admin.
 */
import type express from "express";
import { getProductDb } from "../db/client";
import { loadAccess, type Access } from "./permissions";

export type GetAuthUser = (req: express.Request) => { email?: string } | undefined | null;

export const devViewAsEnabled = () =>
  process.env.NODE_ENV !== "production" && process.env.LAB_DEV_SIMPLE_AUTH === "1";

export type Current = { access: Access | null; viewingAs: boolean };

export async function resolveCurrent(req: express.Request, getAuthUser: GetAuthUser): Promise<Current | null> {
  const user = getAuthUser(req);
  if (!user) return null;
  const db = getProductDb();

  if (devViewAsEnabled()) {
    const viewAs = req.header("x-view-as")?.trim();
    if (viewAs) return { access: await loadAccess(db, viewAs), viewingAs: true };
  }

  const email = (user.email ?? "").trim().toLowerCase();
  const byEmail = await db.query("SELECT id FROM employee_hub.employees WHERE lower(email) = $1", [email]);
  if (byEmail.rows.length) return { access: await loadAccess(db, byEmail.rows[0].id), viewingAs: false };

  if (devViewAsEnabled()) {
    const sa = await db.query(
      `SELECT ra.employee_id FROM employee_hub.role_assignments ra
         JOIN employee_hub.roles r ON r.id = ra.role_id
         JOIN employee_hub.employees e ON e.id = ra.employee_id
        WHERE r.key = 'super_admin' AND e.is_active
        ORDER BY e.last_name LIMIT 1`,
    );
    if (sa.rows.length) return { access: await loadAccess(db, sa.rows[0].employee_id), viewingAs: false };
  }
  return { access: null, viewingAs: false };
}
