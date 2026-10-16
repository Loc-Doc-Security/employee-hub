-- Starter permissions and roles. A first draft to review with Levi, not final: it mirrors what the
-- Wix site can do today (toolAccess keys, manager scope, CSuite, shop admin) so imported people keep
-- the same access. Nothing enforces these yet.
--
-- Every active employee implicitly has the 'employee' role (no assignment row needed).

SET search_path TO employee_hub;

INSERT INTO permissions (key, label, description) VALUES
  ('system.admin',            'System administration',       'Companies, roles, integrations, imports. Multi-company.'),
  ('employees.view',          'View employee profiles',      NULL),
  ('employees.manage',        'Edit employee profiles',      NULL),
  ('lifecycle.manage',        'Onboarding / offboarding',    'Was toolAccess "lifecycleAdmin".'),
  ('bonus.manage',            'Bonus payout calculator',     'Was toolAccess "bonusAdmin".'),
  ('driver_scorecard.upload', 'Driver scorecard upload',     'Was toolAccess "driverScorecard".'),
  ('cleanliness.edit_any',    'Edit anyone''s cleanliness audit', 'Was toolAccess "cleanlinessAdmin".'),
  ('reports.view_team',       'View team reports',           'Scorecards, cleanliness report, weekly reports for people in scope.'),
  ('shop.admin',              'Shop administration',         'Order queue, catalog. Was toolAccess "shopAdmin".'),
  ('shop.order.uniform',      'Order uniforms',              NULL),
  ('shop.order.sanmar',       'Order from SanMar',           NULL),
  ('shop.order.amazon',       'Order from Amazon',           NULL);

INSERT INTO roles (key, name, description) VALUES
  ('super_admin',       'Super Admin',         'Everything, across every company. Assign with global scope.'),
  ('company_admin',     'Company Admin',       'Everything inside one company except system administration.'),
  ('manager',           'Manager',             'Team reports and profiles for the departments in scope. Company scope = all departments (was manager "Operations").'),
  ('csuite',            'C-Suite',             'Company-wide view of people and reports (was department "CSuite").'),
  ('employee',          'Employee',            'Implicit for every active employee.'),
  ('lifecycle_admin',   'Onboarding Admin',    'Single tool.'),
  ('bonus_admin',       'Bonus Admin',         'Single tool.'),
  ('scorecard_uploader','Scorecard Uploader',  'Single tool.'),
  ('cleanliness_admin', 'Cleanliness Admin',   'Single tool.'),
  ('shop_admin',        'Shop Admin',          'Single tool.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r CROSS JOIN permissions p WHERE r.key = 'super_admin'
UNION ALL
SELECT r.id, p.key FROM roles r CROSS JOIN permissions p WHERE r.key = 'company_admin' AND p.key <> 'system.admin'
UNION ALL
SELECT r.id, v.p FROM roles r, (VALUES
    ('manager', 'employees.view'), ('manager', 'reports.view_team'),
    ('csuite', 'employees.view'), ('csuite', 'reports.view_team'),
    ('employee', 'shop.order.uniform'), ('employee', 'shop.order.sanmar'), ('employee', 'shop.order.amazon'),
    ('lifecycle_admin', 'lifecycle.manage'), ('lifecycle_admin', 'employees.view'), ('lifecycle_admin', 'employees.manage'),
    ('bonus_admin', 'bonus.manage'),
    ('scorecard_uploader', 'driver_scorecard.upload'),
    ('cleanliness_admin', 'cleanliness.edit_any'),
    ('shop_admin', 'shop.admin')
  ) AS v(role_key, p)
WHERE r.key = v.role_key;
