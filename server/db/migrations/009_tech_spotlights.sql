-- Tech Spotlight: a tech's problem → solution story, presented at a Wednesday meeting.
-- Decided by Levi, 2026-10-16:
--   - No approval. The scheduled presenter (weekly_meetings.presenter_id) files it for that meeting.
--   - Free editing (autosaved drafts included) through the end of meeting day; locked after.
--   - Super admin only may file or edit on anyone's behalf, any date, any time (used when photo
--     uploads failed and spotlights had to be entered by hand).
--   - Showcase: everyone in the company can browse spotlights once they've been presented.
--   - Old Wix photos are not imported.

SET search_path TO employee_hub;

CREATE TABLE tech_spotlights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  presented_on    date NOT NULL,
  meeting_id      uuid REFERENCES weekly_meetings(id),
  title           text NOT NULL DEFAULT '',
  problem         text NOT NULL DEFAULT '',
  solution        text NOT NULL DEFAULT '',
  slides_url      text CHECK (slides_url IS NULL OR slides_url ~ '^https://'),
  photos          jsonb NOT NULL DEFAULT '[]',  -- [{ "uploadId": "...", "caption": "..." }], in display order
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_at    timestamptz,
  entered_by_id   uuid REFERENCES employees(id),  -- set when a super admin filed it on the tech's behalf
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, presented_on)
);
CREATE INDEX tech_spotlights_company_date_idx ON tech_spotlights (company_id, presented_on DESC);

INSERT INTO permissions (key, label, description) VALUES
  ('spotlights.file_for_anyone', 'File Tech Spotlights for anyone',
   'Enter or fix a spotlight on a tech''s behalf, any date, even after the meeting. Super admin only.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'spotlights.file_for_anyone' FROM roles WHERE key = 'super_admin';
