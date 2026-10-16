-- Wednesday meetings: date, topic, presenting tech, presentation link. Decided by Levi, 2026-10-16:
--   - The deck and the schedule are for managers (plus C-Suite and admins): meetings.manage.
--   - The presenter is PICKED from the employee list (presenter_id), not typed. Wix joined on typed
--     names, which blocked techs whose name was spelled differently. Imported rows whose typed name
--     doesn't match anyone keep it in presenter_name_legacy until someone picks the right person.

SET search_path TO employee_hub;

CREATE TABLE weekly_meetings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  meeting_on             date NOT NULL CHECK (extract(isodow FROM meeting_on) = 3),
  topic                  text NOT NULL DEFAULT '',
  presenter_id           uuid REFERENCES employees(id),
  presenter_name_legacy  text,
  presentation_url       text CHECK (presentation_url IS NULL OR presentation_url ~ '^https://'),
  presentation_type      text CHECK (presentation_type IN ('slides', 'external')),
  updated_by_id          uuid REFERENCES employees(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, meeting_on)
);

INSERT INTO permissions (key, label, description) VALUES
  ('meetings.manage', 'Wednesday Meeting', 'View the meeting deck and edit the schedule (topic, presenter, presentation link).');

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'meetings.manage' FROM roles r WHERE r.key IN ('super_admin', 'company_admin', 'manager', 'csuite');
