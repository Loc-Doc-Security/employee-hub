/**
 * Postgres schema namespace for Employee Hub on the shared Lab database
 * (local Docker `lab_platform`, or production RDS). Used when DATA_BACKEND=postgres.
 * Leave DATA_BACKEND unset/sqlite to keep this app on its own SQLite file.
 */
export function resolvePostgresSchema(envKey: string, fallback = "public"): string {
  const raw = (process.env[envKey] ?? fallback).trim().toLowerCase();
  if (!raw || raw === "public") {
    return "public";
  }
  if (!/^[a-z][a-z0-9_]*$/.test(raw)) {
    throw new Error(`Invalid Postgres schema name in ${envKey}: ${raw}`);
  }
  return raw;
}

export function getAppPostgresSchema(): string {
  return resolvePostgresSchema("EMPLOYEE_HUB_DB_SCHEMA", "employee_hub");
}

/** SQL-safe qualified table reference (schema.table or table). */
export function qualifyTable(schema: string, table: string): string {
  if (!schema || schema === "public") {
    return table;
  }
  return `${schema}.${table}`;
}
