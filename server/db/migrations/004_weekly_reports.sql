-- Weekly Reports: a direct, unfiltered line from every employee to ownership (Levi, 2026-10-16).
--
-- Who sees what:
--   the employee      their own reports (this week + history), never anyone else's
--   managers          who has / hasn't submitted (reports.view_team), NEVER the answers
--   C-Suite only      the answers (weekly_reports.read_all), company scope
-- Deliberately NOT granted to super_admin or company_admin: "anyone else shouldn't see them."
-- (super_admin's grant-everything in 002 only covered permissions that existed then; new
-- permissions are granted explicitly, and this one is withheld on purpose.)
--
-- One report per person per week, no edits after submitting.

SET search_path TO employee_hub;

-- History from people no longer in the employee list (former employees, 2021–2025) keeps a
-- name/email snapshot with employee_id NULL, the same approach as orders. No placeholder
-- employee records are created for them.
CREATE TABLE weekly_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  employee_id       uuid REFERENCES employees(id),
  former_name       text,
  former_email      text,
  week_start        date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  stress_level      smallint NOT NULL CHECK (stress_level BETWEEN 1 AND 5),
  morale            smallint NOT NULL CHECK (morale BETWEEN 1 AND 5),
  workload          smallint NOT NULL CHECK (workload BETWEEN 1 AND 5),
  week_high         text NOT NULL DEFAULT '',
  week_low          text NOT NULL DEFAULT '',
  additional_notes  text NOT NULL DEFAULT '',
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (employee_id IS NOT NULL OR former_email IS NOT NULL OR former_name IS NOT NULL)
);
CREATE UNIQUE INDEX weekly_reports_one_per_week ON weekly_reports (employee_id, week_start) WHERE employee_id IS NOT NULL;
CREATE INDEX weekly_reports_company_week_idx ON weekly_reports (company_id, week_start);

INSERT INTO permissions (key, label, description) VALUES
  ('weekly_reports.read_all', 'Read everyone''s weekly reports',
   'The answers themselves. C-Suite only: a direct line to ownership with no middle-level filtering.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'weekly_reports.read_all' FROM roles WHERE key = 'csuite';
