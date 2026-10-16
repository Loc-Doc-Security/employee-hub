-- Cleanliness Audit + PTO weeks + photo uploads. Decided by Levi, 2026-10-16.
--
-- PTO: a one-button MANAGER decision that exempts a person for one work week, everywhere
-- (cleanliness audit, driver scorecard, weekly-report team status). Stored by work week (Monday);
-- the cleanliness week that opens that Wednesday is the one exempted. Every mark records who
-- decided; removing a mark stamps removed_at/removed_by instead of deleting, so the
-- accountability trail survives.
--
-- Cleanliness audit week: Wednesday 9am → following Tuesday night (locked Wed 00:00–09:00 for the
-- meeting). Employees may edit their own audit until the week closes. Historical audits are
-- imported without photos (Levi: old photos not needed).

SET search_path TO employee_hub;

CREATE TABLE pto_weeks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  employee_id        uuid NOT NULL REFERENCES employees(id),
  week_start         date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  marked_by_id       uuid REFERENCES employees(id),
  marked_by_name     text,  -- only for imported rows whose marker isn't matched to an employee
  marked_at          timestamptz NOT NULL DEFAULT now(),
  removed_at         timestamptz,
  removed_by_id      uuid REFERENCES employees(id),
  source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wix_import'))
);
CREATE UNIQUE INDEX pto_weeks_active ON pto_weeks (employee_id, week_start) WHERE removed_at IS NULL;

CREATE TABLE uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  uploaded_by_id  uuid NOT NULL REFERENCES employees(id),
  purpose         text NOT NULL,
  content_type    text NOT NULL,
  byte_size       integer NOT NULL,
  storage_key     text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cleanliness_audits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  week_start      date NOT NULL CHECK (extract(isodow FROM week_start) = 3),
  has_vehicle     boolean NOT NULL,
  has_office      boolean NOT NULL,
  vehicle_number  text,
  answers         jsonb NOT NULL DEFAULT '{}',   -- {"vehicle": {"floor": true, ...}, "office": {...}}
  photos          jsonb NOT NULL DEFAULT '{}',   -- {"vehicle.cab": "<upload id>", ...}
  pass_count      smallint NOT NULL,
  total_count     smallint NOT NULL,
  score           smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  vehicle_score   smallint CHECK (vehicle_score BETWEEN 0 AND 100),
  office_score    smallint CHECK (office_score BETWEEN 0 AND 100),
  submitted_by_id uuid REFERENCES employees(id),  -- the employee, or a manager/admin filling in for them
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  edit_count      smallint NOT NULL DEFAULT 0,
  last_edited_at  timestamptz,
  last_edited_by_id uuid REFERENCES employees(id),
  UNIQUE (employee_id, week_start)
);
CREATE INDEX cleanliness_audits_company_week_idx ON cleanliness_audits (company_id, week_start);

INSERT INTO permissions (key, label, description) VALUES
  ('pto.mark',                'Mark PTO',                     'Exempt someone for a work week (cleanliness, driver scorecard, weekly report status).'),
  ('cleanliness.view_report', 'View the cleanliness report',  'Company-wide report. Any manager can view it.'),
  ('cleanliness.edit_team',   'Fix team cleanliness audits',  'Edit or submit audits for people in your departments.');

-- New permissions are granted explicitly (super_admin's grant-all in 002 only covered what existed then).
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, v.p FROM roles r, (VALUES
    ('super_admin', 'pto.mark'), ('super_admin', 'cleanliness.view_report'), ('super_admin', 'cleanliness.edit_team'),
    ('company_admin', 'pto.mark'), ('company_admin', 'cleanliness.view_report'), ('company_admin', 'cleanliness.edit_team'),
    ('manager', 'pto.mark'), ('manager', 'cleanliness.view_report'), ('manager', 'cleanliness.edit_team'),
    ('csuite', 'cleanliness.view_report'),
    ('cleanliness_admin', 'cleanliness.view_report')
  ) AS v(role_key, p)
WHERE r.key = v.role_key;
