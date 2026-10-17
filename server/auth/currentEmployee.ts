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

export type GetAuthUser = (req: express.Request) => { email?: string; hubUserId?: string } | undefined | null;

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

  // OMST link: an employee record is matched by its OMST user id once linked. A record added by
  // hand (or imported) has no OMST id yet; the first OMST sign-in with the same email links it
  // permanently, so a later email change in OMST can't detach it. A record already linked to a
  // DIFFERENT OMST account is never matched by email (no taking over someone else's record).
  const omstId = user.hubUserId?.trim();
  if (omstId) {
    const linked = await db.query("SELECT id FROM employee_hub.employees WHERE omst_user_id = $1", [omstId]);
    if (linked.rows.length) return { access: await loadAccess(db, linked.rows[0].id), viewingAs: false };
  }
  const email = (user.email ?? "").trim().toLowerCase();
  const byEmail = await db.query("SELECT id, omst_user_id FROM employee_hub.employees WHERE lower(email) = $1", [email]);
  const match = byEmail.rows[0];
  if (match && omstId && match.omst_user_id && match.omst_user_id !== omstId) return { access: null, viewingAs: false };
  if (match) {
    if (omstId && !match.omst_user_id) {
      await db.query("UPDATE employee_hub.employees SET omst_user_id = $2, updated_at = now() WHERE id = $1 AND omst_user_id IS NULL", [match.id, omstId]);
      await db.query(
        `INSERT INTO employee_hub.admin_activity (company_id, actor_id, action, target_type, target_id, summary, after)
         SELECT company_id, id, 'employee.omst_link', 'employee', id, 'Linked to OMST account on first sign-in', jsonb_build_object('omst_user_id', $2::text)
           FROM employee_hub.employees WHERE id = $1`, [match.id, omstId]);
    }
    return { access: await loadAccess(db, match.id), viewingAs: false };
  }

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
