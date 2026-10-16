-- Core data model: companies, org structure, employees, roles and permissions.
-- Naming follows the migration plan (teamwix-v2/docs/SCHEMA-NAMING.md): snake_case plural tables,
-- person links are always ids, imported rows keep their Wix _id as id.
-- Everything lives in the employee_hub schema so the same SQL runs on the local Postgres and on
-- OMST's shared database.

CREATE SCHEMA IF NOT EXISTS employee_hub;
SET search_path TO employee_hub;

CREATE TABLE companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  email_domains text[] NOT NULL DEFAULT '{}',
  logo_url      text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- The employee profile. OMST owns identity (email + which services someone can open); everything
-- else about the person lives here. Vehicle assignment is vehicle_number (the fleet itself is
-- managed in a separate app).
CREATE TABLE employees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  omst_user_id       text UNIQUE,
  email              text NOT NULL,
  first_name         text NOT NULL DEFAULT '',
  last_name          text NOT NULL DEFAULT '',
  title              text,
  phone              text,
  photo_url          text,
  hired_on           date,
  employee_type      text CHECK (employee_type IN ('office', 'tech')),
  branch_id          uuid REFERENCES branches(id),
  vehicle_number     text,
  vehicle_noun       text,
  has_office         boolean NOT NULL DEFAULT false,
  is_bonus_eligible  boolean NOT NULL DEFAULT true,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employees_email_key ON employees (lower(email));
CREATE INDEX employees_company_idx ON employees (company_id);

-- Department membership ("belongs to"). Managing a department is a role assignment, not this.
CREATE TABLE employee_departments (
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id  uuid NOT NULL REFERENCES departments(id),
  PRIMARY KEY (employee_id, department_id)
);

-- Permissions are specific actions (e.g. 'driver_scorecard.upload'). Roles are named bundles of
-- permissions. A role assignment grants a role to an employee within a scope.
CREATE TABLE permissions (
  key          text PRIMARY KEY,
  label        text NOT NULL,
  description  text
);

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  text NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission_key)
);

-- scope_type decides which of company_id / department_id is set:
--   global      neither (everything, every company)
--   company     company_id
--   department  company_id + department_id
-- source = 'wix_import' rows are replaced on every import re-run; 'manual' rows are never touched
-- by the importer.
CREATE TABLE role_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_id        uuid NOT NULL REFERENCES roles(id),
  scope_type     text NOT NULL CHECK (scope_type IN ('global', 'company', 'department')),
  company_id     uuid REFERENCES companies(id),
  department_id  uuid REFERENCES departments(id),
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wix_import')),
  granted_by_id  uuid REFERENCES employees(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope_type = 'global'     AND company_id IS NULL     AND department_id IS NULL) OR
    (scope_type = 'company'    AND company_id IS NOT NULL AND department_id IS NULL) OR
    (scope_type = 'department' AND company_id IS NOT NULL AND department_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX role_assignments_unique
  ON role_assignments (employee_id, role_id, scope_type,
                       coalesce(company_id, '00000000-0000-0000-0000-000000000000'),
                       coalesce(department_id, '00000000-0000-0000-0000-000000000000'));
