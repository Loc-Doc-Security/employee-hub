-- 1:1 meetings. Decided by Levi, 2026-10-16:
--   - Managers write 1:1s for their own people (company-wide "Operations" managers: anyone).
--   - Readers: the employee (their own), their managers, Operations (company-scope managers) and
--     C-Suite (everyone). Super admin is NOT granted read; only the people Levi named.
--   - No edits after saving (until someone asks for it). Employees can't reply; the Weekly Report
--     is their channel back.
--   - "1:1 done this month" for the scorecard is derived from this table directly (no separate
--     MeasurableEntries row like Wix kept).

SET search_path TO employee_hub;

CREATE TABLE one_on_ones (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  employee_id           uuid NOT NULL REFERENCES employees(id),
  manager_id            uuid REFERENCES employees(id),
  manager_former_name   text,  -- imported rows whose manager isn't in the employee list
  met_on                date NOT NULL,
  month                 date NOT NULL CHECK (extract(day FROM month) = 1),
  areas_of_improvement  text NOT NULL DEFAULT '',
  whats_going_well      text NOT NULL DEFAULT '',
  whats_not_going_well  text NOT NULL DEFAULT '',
  needs                 text NOT NULL DEFAULT '',
  how_can_i_help        text NOT NULL DEFAULT '',
  site_visits           jsonb NOT NULL DEFAULT '[]',  -- [{ "label": "job #", "notes": "…" }]
  follow_ups            text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (manager_id IS NOT NULL OR manager_former_name IS NOT NULL),
  CHECK (manager_id IS DISTINCT FROM employee_id)
);
CREATE INDEX one_on_ones_employee_idx ON one_on_ones (employee_id, met_on DESC);
CREATE INDEX one_on_ones_company_month_idx ON one_on_ones (company_id, month);

INSERT INTO permissions (key, label, description) VALUES
  ('one_on_ones.write', 'Log 1:1s',  'Managers, for people in their departments.'),
  ('one_on_ones.read',  'Read 1:1s', 'Managers (their people), Operations and C-Suite (everyone). Employees always read their own.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, v.p FROM roles r, (VALUES
    ('manager', 'one_on_ones.write'), ('manager', 'one_on_ones.read'),
    ('csuite', 'one_on_ones.read')
  ) AS v(role_key, p)
WHERE r.key = v.role_key;
