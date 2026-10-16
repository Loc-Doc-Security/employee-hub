-- Every employee can read their own company's People directory (Levi, 2026-10-16). Read-only:
-- editing stays behind employees.manage.
SET search_path TO employee_hub;

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'employees.view' FROM roles WHERE key = 'employee'
ON CONFLICT DO NOTHING;
