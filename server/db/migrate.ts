/**
 * Applies server/db/migrations/*.sql in filename order, each in its own transaction, and records
 * what has run in employee_hub.schema_migrations so a re-run only applies new files.
 *
 * Usage: npx tsx server/db/migrate.ts
 * Connects with PRODUCT_DATABASE_URL (from .env.local / .env).
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

async function main() {
  const url = process.env.PRODUCT_DATABASE_URL?.trim();
  if (!url) throw new Error("Set PRODUCT_DATABASE_URL (see .env.example).");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS employee_hub");
    await client.query(`CREATE TABLE IF NOT EXISTS employee_hub.schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set(
      (await client.query("SELECT filename FROM employee_hub.schema_migrations")).rows.map((r) => r.filename),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO employee_hub.schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file} failed: ${(err as Error).message}`);
      }
      console.log(`applied ${file}`);
      applied++;
    }
    console.log(applied ? `${applied} migration(s) applied.` : "Already up to date.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
