-- Resources: policies, processes and tutorials. Decided by Levi, 2026-10-19:
--   - A Google Drive folder per company is the single source of truth for documents. People add or
--     update Google Docs there (with Drive's version history); the hub reads the folder itself (no
--     n8n) and mirrors each Doc read-only. Subfolders are the categories. Levi controls who can see
--     and edit the folder in Drive; the hub never edits a Doc, it links to it.
--   - PDFs and videos can't be edited anyway, so they're uploaded in the hub instead of living in
--     the folder. A resource can also be a plain link (a video elsewhere, a web page).
--   - Resources belong to one company; company_id NULL marks an OMS-wide resource every company sees.
--   - Every resource has a stable address (/resources/<slug>) that menus, onboarding steps and
--     messages can point at. A slug never changes once given, even if the Doc is renamed.

SET search_path TO employee_hub;

INSERT INTO permissions (key, label, description) VALUES
  ('resources.manage', 'Resources', 'Upload PDFs and videos, add links, connect the Drive folder and sync it.');

INSERT INTO roles (key, name, description) VALUES
  ('resources_admin', 'Resources Admin', 'Single tool.');

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'resources.manage' FROM roles WHERE key IN ('resources_admin', 'company_admin', 'super_admin');

-- The Drive folder each company's documents come from (company_id NULL = the OMS-wide folder).
CREATE TABLE resource_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid REFERENCES companies(id),
  drive_folder_id  text NOT NULL,
  last_synced_at   timestamptz,
  last_result      jsonb,          -- { added, updated, archived, skipped: [{ name, reason }] } or { error }
  updated_by_id    uuid REFERENCES employees(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX resource_sources_company ON resource_sources ((coalesce(company_id::text, 'oms')));

CREATE TABLE resources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid REFERENCES companies(id),
  slug               text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind               text NOT NULL CHECK (kind IN ('doc', 'file', 'link')),
  title              text NOT NULL,
  description        text,
  category           text NOT NULL DEFAULT 'General',
  -- doc: mirrored from Drive
  drive_file_id      text UNIQUE,
  drive_modified_at  timestamptz,
  content_html       text,
  -- file: uploaded PDF or video
  upload_id          uuid REFERENCES uploads(id),
  -- link
  url                text CHECK (url IS NULL OR url ~ '^https?://'),
  search_text        text NOT NULL DEFAULT '',
  is_active          boolean NOT NULL DEFAULT true,
  source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'drive', 'wix_import')),
  created_by_id      uuid REFERENCES employees(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'doc'  AND drive_file_id IS NOT NULL)
      OR (kind = 'file' AND upload_id IS NOT NULL)
      OR (kind = 'link' AND url IS NOT NULL))
);
CREATE UNIQUE INDEX resources_slug ON resources ((coalesce(company_id::text, 'oms')), slug);
CREATE INDEX resources_company_idx ON resources (company_id) WHERE is_active;
