-- Bonus payouts. Decided by Levi (formula 2026-08-26, rebuilt here 2026-10-19 unchanged):
--   - A monthly bonus pool splits 50% Reliability / 35% Profitability / 15% Tenure. Each person's
--     share of a part = their score ÷ the sum of everyone's (eligible, not excluded) scores.
--   - Reliability: average of the six peer assessment criteria received in the last 190 days.
--     Tenure: years since hire date. Profitability: per team, 2 missed / 3 hit / 4 exceeded
--     (manual, default 3), with a per-person override.
--   - Every row is explicitly confirmed (paid, rounded to the dollar) or excluded ($0) before the
--     month's run can be saved; saving again replaces that month's run.
--   - ONE role for the whole process (pool, run, review, payroll export): Bonus Admin. Anyone who
--     can see any of it can do all of it; nobody else sees bonus numbers (not even Super Admin or
--     Company Admin through those roles). Employees don't see their own bonus (yet).
--   - Who's eligible (employees.is_bonus_eligible) and hire dates are kept by the Onboarding Admin.

SET search_path TO employee_hub;

DELETE FROM role_permissions
 WHERE permission_key = 'bonus.manage'
   AND role_id IN (SELECT id FROM roles WHERE key IN ('super_admin', 'company_admin'));

UPDATE permissions SET description = 'Bonus pool, payout run, review and payroll export. Bonus Admins only.'
 WHERE key = 'bonus.manage';

CREATE TABLE bonus_pools (
  company_id   uuid NOT NULL REFERENCES companies(id),
  month        date NOT NULL CHECK (extract(day FROM month) = 1),
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  set_by_id    uuid REFERENCES employees(id),
  set_by_name  text,                      -- kept for imported pools
  set_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, month)
);

CREATE TABLE bonus_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  month           date NOT NULL CHECK (extract(day FROM month) = 1),
  pool_amount     numeric(12,2) NOT NULL,
  saved_by_id     uuid REFERENCES employees(id),
  saved_by_name   text,
  saved_at        timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wix_import')),
  UNIQUE (company_id, month)
);

CREATE TABLE bonus_payouts (
  run_id               uuid NOT NULL REFERENCES bonus_runs(id) ON DELETE CASCADE,
  employee_id          uuid NOT NULL REFERENCES employees(id),
  employee_name        text NOT NULL,     -- as of the run
  team                 text NOT NULL,
  reliability_score    numeric(6,4) NOT NULL,
  reliability_share    numeric(10,8) NOT NULL,
  profitability_score  smallint NOT NULL CHECK (profitability_score BETWEEN 2 AND 4),
  profitability_share  numeric(10,8) NOT NULL,
  tenure_years         numeric(6,2) NOT NULL,
  tenure_share         numeric(10,8) NOT NULL,
  suggested_bonus      numeric(12,2) NOT NULL,
  status               text NOT NULL CHECK (status IN ('confirmed', 'excluded')),
  payout               integer NOT NULL CHECK (payout >= 0),
  PRIMARY KEY (run_id, employee_id)
);
