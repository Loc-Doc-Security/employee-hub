-- Driver Scorecard: the weekly Geotab "Expanded" PDF, parsed deterministically (no AI fallback,
-- Levi 2026-10-16). Matching is by van number (employees.vehicle_number). Re-uploading a week
-- replaces it. Geotab weeks run Sunday → Saturday; PTO for the work week that starts the next
-- Monday parks the driver.
--
-- Who sees what (Levi, 2026-10-16): drivers their own scores; managers their people's (1:1 review,
-- scorecard, reference only, not scored); the whole fleet in the Wednesday deck (meetings.manage);
-- upload = Scorecard Uploader role or any manager.

SET search_path TO employee_hub;

CREATE TABLE driver_score_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  week_start         date NOT NULL,
  week_end           date NOT NULL,
  week_label         text NOT NULL,
  fleet_score        numeric(5,2),
  uploaded_by_id     uuid REFERENCES employees(id),
  source             text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'wix_import')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, week_start)
);

CREATE TABLE driver_scores (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id                uuid NOT NULL REFERENCES driver_score_reports(id) ON DELETE CASCADE,
  employee_id              uuid REFERENCES employees(id),
  vehicle_label            text NOT NULL,   -- as printed: "147", "Van 144 ALT", an asset tag
  driver_name_raw          text NOT NULL DEFAULT '',
  group_name               text NOT NULL DEFAULT '',
  classification           text NOT NULL DEFAULT '',
  score                    numeric(5,2),
  hard_acceleration_score  numeric(5,2),
  harsh_braking_score      numeric(5,2),
  harsh_cornering_score    numeric(5,2),
  seatbelt_score           numeric(5,2),
  speeding_score           numeric(5,2),
  distracted_score         numeric(5,2),
  is_parked                boolean NOT NULL DEFAULT false,
  parked_reason            text CHECK (parked_reason IN ('no_activity', 'no_employee_match', 'inactive', 'pto'))
);
CREATE INDEX driver_scores_report_idx ON driver_scores (report_id);
CREATE INDEX driver_scores_employee_idx ON driver_scores (employee_id);

-- Managers can upload too (Wix allowed any manager); the Scorecard Uploader role already has it.
INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'driver_scorecard.upload' FROM roles WHERE key = 'manager'
ON CONFLICT DO NOTHING;
