-- Shop + points. Decided by Levi, 2026-10-15/16 (see teamwix-v2/docs/ORDERS-UNIFIED.md):
--   - One catalog (shared by all companies), one orders table with three order types:
--     uniform (catalog), sanmar and amazon (typed items, estimate charged up front, admin confirms).
--   - Statuses are the Wix shop's own workflow; archiving is a separate flag.
--   - Points are our own ledger: every change is a row with its reason and who did it; the balance
--     is the sum. Imported order history never posts to the ledger (the opening balance already
--     reflects it).
--   - Shop Admins (Levi, David Snipes, Adam Svagr) add/deduct points by hand and manage point rules,
--     which a daily job applies (birthday 300 pre-set; on-hire amount left blank until set).
--     Each rule pays a person at most once per period.

SET search_path TO employee_hub;

ALTER TABLE employees ADD COLUMN birthday_md text CHECK (birthday_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

CREATE TABLE catalog_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  price                  numeric(10,2) NOT NULL CHECK (price >= 0),
  image_upload_id        uuid REFERENCES uploads(id),
  options                jsonb NOT NULL DEFAULT '[]',   -- [{ "label": "Size", "choices": ["S","M","L"] }]
  is_visible             boolean NOT NULL DEFAULT true,
  legacy_wix_product_id  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE order_numbers START 1100;

CREATE TABLE orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  order_number         integer UNIQUE DEFAULT nextval('employee_hub.order_numbers'),
  order_type           text NOT NULL CHECK (order_type IN ('uniform', 'sanmar', 'amazon')),
  employee_id          uuid REFERENCES employees(id),
  customer_name        text NOT NULL,   -- snapshot at order time
  customer_email       text NOT NULL DEFAULT '',
  status               text NOT NULL CHECK (status IN ('pending_pricing', 'ready_to_order', 'ordered', 'waiting_bulk',
                         'partially_received', 'received', 'waiting_pickup', 'cancelled')),
  archived_at          timestamptz,
  is_stock_order       boolean NOT NULL DEFAULT false,
  points_estimated     integer,
  points_charged       integer NOT NULL DEFAULT 0,
  pricing_confirmed    boolean NOT NULL DEFAULT false,
  ordered_at           timestamptz NOT NULL DEFAULT now(),
  est_delivery         date,
  cancelled_at         timestamptz,
  cancel_reason        text,
  admin_notes          text NOT NULL DEFAULT '',
  legacy_source        text CHECK (legacy_source IN ('sanmar_cms_orders', 'wix_stores')),
  legacy_id            text,
  legacy_number        text,
  legacy_wix_order_id  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legacy_source, legacy_id)
);
CREATE INDEX orders_company_idx ON orders (company_id, ordered_at DESC);
CREATE INDEX orders_employee_idx ON orders (employee_id);

CREATE TABLE order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  catalog_item_id    uuid REFERENCES catalog_items(id),
  name               text NOT NULL DEFAULT '',
  sku                text NOT NULL DEFAULT '',
  link               text,
  quantity           integer NOT NULL CHECK (quantity > 0),
  unit_price         numeric(10,2) NOT NULL DEFAULT 0,
  line_total         numeric(10,2) NOT NULL DEFAULT 0,
  refunded_quantity  integer NOT NULL DEFAULT 0,
  options            jsonb NOT NULL DEFAULT '{}',   -- { "Size": "XL", "Color": "Navy" }
  branding           jsonb NOT NULL DEFAULT '{}'    -- SanMar logo fields: logo, logoColor, placement, fees
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE point_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  name           text NOT NULL,
  trigger        text NOT NULL CHECK (trigger IN ('birthday', 'on_hire', 'hire_anniversary', 'monthly')),
  amount         integer CHECK (amount IS NULL OR amount <> 0),  -- NULL = not paying out until someone sets it
  is_active      boolean NOT NULL DEFAULT true,
  created_by_id  uuid REFERENCES employees(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE point_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  amount         integer NOT NULL CHECK (amount <> 0),
  kind           text NOT NULL CHECK (kind IN ('opening', 'grant', 'rule', 'order_charge', 'order_settle', 'order_refund')),
  reason         text NOT NULL DEFAULT '',
  order_id       uuid REFERENCES orders(id),
  rule_id        uuid REFERENCES point_rules(id),
  created_by_id  uuid REFERENCES employees(id),   -- NULL = the system (rules job, import)
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX point_transactions_employee_idx ON point_transactions (employee_id, created_at DESC);

CREATE TABLE point_rule_awards (
  rule_id         uuid NOT NULL REFERENCES point_rules(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id),
  period          text NOT NULL,   -- "2026" (yearly rules), "2026-10" (monthly), "once" (on hire)
  transaction_id  uuid NOT NULL REFERENCES point_transactions(id),
  awarded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, employee_id, period)
);

INSERT INTO permissions (key, label, description) VALUES
  ('points.manage', 'Points', 'Add or deduct points by hand and manage automatic point rules. Shop Admins.');
INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'points.manage' FROM roles WHERE key = 'shop_admin';
