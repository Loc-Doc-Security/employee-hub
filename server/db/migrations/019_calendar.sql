-- Calendar (Levi, 2026-10-19): one read-only place for everything dated. Holidays and company/team
-- events are kept here in the hub (not the company Google Calendar) by Calendar Admins; everything
-- else is pulled from where it already lives: Wednesday meetings (topic, presenter, spotlights),
-- PTO (everyone sees who's out), birthdays and work anniversaries.

SET search_path TO employee_hub;

INSERT INTO permissions (key, label, description) VALUES
  ('calendar.manage', 'Calendar', 'Add, edit and remove holidays and company events on the Calendar.');

INSERT INTO roles (key, name, description) VALUES
  ('calendar_admin', 'Calendar Admin', 'Single tool.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'calendar.manage' FROM roles WHERE key IN ('calendar_admin', 'company_admin', 'super_admin');

CREATE TABLE calendar_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  kind           text NOT NULL CHECK (kind IN ('holiday', 'event')),
  title          text NOT NULL CHECK (length(trim(title)) > 0),
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,          -- same as starts_on for one day
  start_time     time,                   -- NULL = all day
  end_time       time,
  location       text,
  description    text,
  office_closed  boolean NOT NULL DEFAULT false,   -- holidays: the office is closed that day
  created_by_id  uuid REFERENCES employees(id),
  updated_by_id  uuid REFERENCES employees(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (end_time IS NULL OR start_time IS NOT NULL),
  CHECK (ends_on - starts_on <= 31)
);
CREATE INDEX calendar_events_company_dates ON calendar_events (company_id, starts_on, ends_on);
