#!/usr/bin/env bash
# Register a satellite app in hub.app_registry (dev Postgres). Run from workspace root.
set -euo pipefail
APP_ID="${1:?app id required}"
TITLE="${2:-$APP_ID}"
SCHEMA="${3:-$APP_ID}"
URL="${DATABASE_URL:-postgresql://lab:lab@127.0.0.1:5433/lab_platform}"

psql "$URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO hub.app_registry (id, title, url_env_key, default_url, schema_name, requires_oms, sort_order, created_at, updated_at)
VALUES (
  '$APP_ID',
  '$TITLE',
  '${APP_ID^^}_APP_URL',
  'http://localhost:3005',
  '$SCHEMA',
  false,
  99,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, schema_name = EXCLUDED.schema_name, updated_at = NOW();
SQL

echo "Registered $APP_ID in hub.app_registry — enable entitlement in Hub admin for LocDoc provider."
