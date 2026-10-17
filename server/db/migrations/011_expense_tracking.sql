-- Credit card receipt compliance, synced weekly by n8n from accounting's "28 Day Rolling Data"
-- sheet (each row: an employee's purchases and receipts uploaded over the last 28 days).
-- Decided by Levi, 2026-10-16:
--   - Every sync is kept as a dated snapshot (Wix overwrote last week's numbers).
--   - Rows link by employee id (the sheet's Employee Number column = the Wix _id, which the
--     import kept); departments for grouping come from the Employee Hub, not the sheet's own text.
--   - Everyone sees the department report (weighted: total receipts ÷ total purchases). Each
--     employee sees their own numbers; managers see their people's.

SET search_path TO employee_hub;

CREATE TABLE expense_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  week_start  date NOT NULL CHECK (extract(isodow FROM week_start) = 1),  -- the Monday of the sync week
  source      text NOT NULL DEFAULT 'n8n' CHECK (source IN ('n8n', 'wix_import')),
  synced_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, week_start)
);

CREATE TABLE expense_tracking (
  snapshot_id        uuid NOT NULL REFERENCES expense_snapshots(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES employees(id),
  total_purchases    integer NOT NULL CHECK (total_purchases >= 0),
  receipts_uploaded  integer NOT NULL CHECK (receipts_uploaded >= 0),
  PRIMARY KEY (snapshot_id, employee_id)
);
CREATE INDEX expense_tracking_employee_idx ON expense_tracking (employee_id);
