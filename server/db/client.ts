import pg from "pg";

export const PRODUCT_DB_ENGINE = "postgres" as const;

let pool: pg.Pool | null = null;

export function getProductDb(): pg.Pool {
  if (!pool) {
    const url = process.env.PRODUCT_DATABASE_URL;
    if (!url) throw new Error("Set PRODUCT_DATABASE_URL for PostgreSQL");
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
}

export async function pingProductDb(): Promise<"skipped" | "ok" | "error"> {
  if (!process.env.PRODUCT_DATABASE_URL?.trim()) return "skipped";
  try {
    await getProductDb().query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}
