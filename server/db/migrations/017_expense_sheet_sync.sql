-- Credit card sync straight from accounting's Google Sheet (n8n retired, Levi 2026-10-19).
-- The hub reads the "28 Day Rolling Data" sheet with the same Google service account as Resources:
-- automatically once a week, and whenever accounting presses "Sync now" after a last-minute change.

SET search_path TO employee_hub;

INSERT INTO permissions (key, label, description) VALUES
  ('expenses.sync', 'Sync credit card data', 'Connect accounting''s sheet and press "Sync now" on Credit Card Receipts.');

INSERT INTO roles (key, name, description) VALUES
  ('accounting', 'Accounting', 'Syncs the credit card receipts sheet.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'expenses.sync' FROM roles WHERE key IN ('accounting', 'company_admin', 'super_admin');

CREATE TABLE expense_sources (
  company_id      uuid PRIMARY KEY REFERENCES companies(id),
  sheet_id        text NOT NULL CHECK (sheet_id ~ '^[A-Za-z0-9_-]{20,}$'),
  sheet_gid       text,                 -- which tab; NULL = the first one
  last_synced_at  timestamptz,
  last_result     jsonb,                -- { saved, unmatched: [{ name, reason }] } or { error }
  updated_by_id   uuid REFERENCES employees(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expense_snapshots DROP CONSTRAINT expense_snapshots_source_check;
ALTER TABLE expense_snapshots ADD CONSTRAINT expense_snapshots_source_check CHECK (source IN ('n8n', 'wix_import', 'sheet'));
ALTER TABLE expense_snapshots ADD COLUMN synced_by_id uuid REFERENCES employees(id);  -- who pressed Sync now (NULL = automatic)
