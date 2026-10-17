-- "On hire" pays only people hired on or after the day the rule took effect, so turning it on (or
-- setting its amount) never back-pays everyone already employed. Set whenever a rule's amount goes
-- from blank to a number.
SET search_path TO employee_hub;
ALTER TABLE point_rules ADD COLUMN effective_from date;
UPDATE point_rules SET effective_from = created_at::date WHERE amount IS NOT NULL;
