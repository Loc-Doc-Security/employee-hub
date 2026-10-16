-- Peer Assessments: teammates score each other monthly on the six core-value criteria (1–4).
-- Decided by Levi, 2026-10-16:
--   - The person assessed sees their averages and the feedback text, never who wrote it.
--   - Who assessed whom: C-Suite only (peer_assessments.see_authors).
--   - Managers see their people's averages (reports.view_team), never feedback or authors.
--   - Each month, an assessor's list = everyone in their department + 2 random teammates from
--     outside it (more random picks if that totals fewer than 5). Picked once, fixed for the month.
--     That list is the default "My Team" view; anyone in the company can still be assessed.
--   - No edits after submitting.
-- History from people no longer in the employee list keeps name/email snapshots (as weekly_reports).

SET search_path TO employee_hub;

CREATE TABLE peer_assessments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  month              date NOT NULL CHECK (extract(day FROM month) = 1),
  assessed_on        date NOT NULL,
  subject_id         uuid REFERENCES employees(id),
  subject_former_name text,
  submitted_by_id    uuid REFERENCES employees(id),
  submitter_former_name  text,
  submitter_former_email text,
  humble             smallint NOT NULL CHECK (humble BETWEEN 1 AND 4),
  hungry             smallint NOT NULL CHECK (hungry BETWEEN 1 AND 4),
  smart              smallint NOT NULL CHECK (smart BETWEEN 1 AND 4),
  helpful_kind       smallint NOT NULL CHECK (helpful_kind BETWEEN 1 AND 4),
  fast_response      smallint NOT NULL CHECK (fast_response BETWEEN 1 AND 4),
  solves_problems    smallint NOT NULL CHECK (solves_problems BETWEEN 1 AND 4),
  -- New submissions: one note per criterion scored 1 or 4 (required) + optional general note.
  -- Imported history only has the old single combined text, kept in general_feedback.
  criterion_feedback jsonb NOT NULL DEFAULT '{}',
  general_feedback   text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (subject_id IS NOT NULL OR subject_former_name IS NOT NULL),
  CHECK (submitted_by_id IS NOT NULL OR submitter_former_name IS NOT NULL OR submitter_former_email IS NOT NULL),
  CHECK (subject_id IS NULL OR submitted_by_id IS NULL OR subject_id <> submitted_by_id)
);
CREATE UNIQUE INDEX peer_assessments_once_per_month
  ON peer_assessments (submitted_by_id, subject_id, month)
  WHERE submitted_by_id IS NOT NULL AND subject_id IS NOT NULL;
CREATE INDEX peer_assessments_subject_month_idx ON peer_assessments (subject_id, month);

CREATE TABLE peer_assessment_assignments (
  company_id   uuid NOT NULL REFERENCES companies(id),
  month        date NOT NULL CHECK (extract(day FROM month) = 1),
  assessor_id  uuid NOT NULL REFERENCES employees(id),
  subject_id   uuid NOT NULL REFERENCES employees(id),
  reason       text NOT NULL CHECK (reason IN ('department', 'random')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessor_id, month, subject_id),
  CHECK (assessor_id <> subject_id)
);

INSERT INTO permissions (key, label, description) VALUES
  ('peer_assessments.see_authors', 'See who assessed whom',
   'Names on peer assessments. C-Suite only; everyone else sees anonymous averages and feedback.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'peer_assessments.see_authors' FROM roles WHERE key = 'csuite';
