-- A rule award can also record "already paid by Wix Loyalty" (no transaction of ours), so importing
-- Wix balances marks this year's past birthdays as paid and the rules job never pays them twice.
SET search_path TO employee_hub;
ALTER TABLE point_rule_awards ALTER COLUMN transaction_id DROP NOT NULL;
ALTER TABLE point_rule_awards ADD COLUMN paid_by text NOT NULL DEFAULT 'employee_hub' CHECK (paid_by IN ('employee_hub', 'wix_loyalty'));
