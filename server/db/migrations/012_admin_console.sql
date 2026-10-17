-- Admin console. Decided by Levi, 2026-10-16:
--   - The Onboarding Admin role (lifecycle_admin) is the ONE gate for people changes: add, edit,
--     deactivate/reactivate, grant/remove roles, departments and branches. They also control every
--     tech's app access in OMST, so all onboarding/offboarding passes through them. (Today: Levi
--     and David Snipes.) Company admins and super admin do NOT get these through their own roles.
--   - Super Admin can't be granted from the app at all; new companies stay super admin only.
--   - Manually added employees link to their OMST account automatically on first sign-in.
--   - Every admin action is written to admin_activity (who, what, before/after).

SET search_path TO employee_hub;

INSERT INTO permissions (key, label, description) VALUES
  ('roles.grant', 'Grant and remove roles', 'Onboarding Admin only. Super Admin can never be granted from the app.'),
  ('org.manage',  'Departments and branches', 'Add, rename and retire departments and branches.');

DELETE FROM role_permissions
 WHERE permission_key = 'employees.manage'
   AND role_id IN (SELECT id FROM roles WHERE key IN ('super_admin', 'company_admin'));

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, v.p FROM roles r, (VALUES ('employees.manage'), ('roles.grant'), ('org.manage')) AS v(p)
WHERE r.key = 'lifecycle_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE admin_activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES companies(id),
  actor_id     uuid NOT NULL REFERENCES employees(id),
  action       text NOT NULL,          -- e.g. employee.create, employee.update, role.grant, department.create
  target_type  text NOT NULL,          -- employee | role_assignment | department | branch | company
  target_id    uuid,
  summary      text NOT NULL,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_activity_company_idx ON admin_activity (company_id, created_at DESC);
