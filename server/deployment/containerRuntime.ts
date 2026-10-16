import { PRODUCTION_EFS_SQLITE_PATH } from "../paths/sqlitePaths";

export const ECS_ALB_HEALTH_CHECK_PATHS = ["/api/health"] as const;
export const FARGATE_LISTEN_HOST = "0.0.0.0" as const;

export function parseListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PORT ?? 3000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
}

/**
 * App-shell state backend: sqlite (default, own file/EFS) or postgres (shared Lab RDS, own schema).
 * Product DB (`PRODUCT_DB_ENGINE`) is a separate optional database.
 */
export function validateSqlBackendEnv(env: NodeJS.ProcessEnv) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const appBackend = (env.DATA_BACKEND?.toLowerCase().trim() || "sqlite") as string;

  if (appBackend === "in-memory") {
    errors.push("DATA_BACKEND=in-memory is not supported; use sqlite or postgres.");
  }

  if (appBackend === "postgres") {
    if (!env.DATABASE_URL?.trim()) {
      errors.push("DATA_BACKEND=postgres requires DATABASE_URL (shared Lab Postgres / RDS).");
    }
  } else if (appBackend === "sqlite") {
    if (env.NODE_ENV === "production" && !env.SQLITE_DB_PATH?.trim()) {
      errors.push(`Production SQLite requires SQLITE_DB_PATH (ECS + EFS: ${PRODUCTION_EFS_SQLITE_PATH}).`);
    }
  } else if (appBackend !== "mysql") {
    errors.push(`Unknown DATA_BACKEND "${env.DATA_BACKEND ?? ""}"; use sqlite or postgres.`);
  }

  if (env.HUB_AUTH_ENABLED === "1" && !env.HUB_JWT_SECRET?.trim()) {
    errors.push("HUB_AUTH_ENABLED=1 requires HUB_JWT_SECRET.");
  }
  const product = env.PRODUCT_DB_ENGINE || "none";
  if (product !== "none" && !env.DATABASE_URL?.trim() && product !== "sqlite-file") {
    warnings.push(`PRODUCT_DB_ENGINE=${product} but DATABASE_URL is empty — product DB ping will be skipped.`);
  }
  return { errors, warnings };
}
