import { Pool } from "pg";
import type { AppStateSnapshot, StateRepository } from "./types";
import { getAppPostgresSchema, qualifyTable } from "./postgresConfig";

type QueryRunner = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function databaseSsl() {
  if (process.env.DATABASE_SSL === "0") return undefined;
  if (process.env.DATABASE_SSL === "1") return { rejectUnauthorized: false };
  return undefined;
}

export class PostgresRepository implements StateRepository {
  private pool: Pool;
  private readonly schema: string;

  constructor(private connectionString?: string) {
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for PostgresRepository");
    }
    this.pool = new Pool({ connectionString, ssl: databaseSsl() });
    this.schema = getAppPostgresSchema();
  }

  getSchema(): string {
    return this.schema;
  }

  private table(name: string): string {
    return qualifyTable(this.schema, name);
  }

  private async ensureSchema() {
    if (this.schema !== "public") {
      await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table("users")} (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table("auth_credentials")} (
        username TEXT PRIMARY KEY,
        payload JSONB NOT NULL
      )
    `);
  }

  async load(): Promise<AppStateSnapshot> {
    await this.ensureSchema();
    const runner = this.pool as unknown as QueryRunner;

    const usersResult = await runner.query(`SELECT payload FROM ${this.table("users")}`);
    const users = usersResult.rows.map(
      (row) => row.payload as AppStateSnapshot["users"][number],
    );

    const credResult = await runner.query(`SELECT username, payload FROM ${this.table("auth_credentials")}`);
    const authCredentials: AppStateSnapshot["authCredentials"] = {};
    for (const row of credResult.rows) {
      authCredentials[String(row.username)] = row.payload as AppStateSnapshot["authCredentials"][string];
    }

    return { users, authCredentials };
  }

  async save(snapshot: AppStateSnapshot): Promise<void> {
    await this.ensureSchema();
    const runner = this.pool as unknown as QueryRunner;

    const usersTable = this.table("users");
    const credTable = this.table("auth_credentials");
    const userIds = snapshot.users.map((user) => user.id);
    const userPayloads = snapshot.users.map((user) => JSON.stringify(user));
    const credKeys = Object.keys(snapshot.authCredentials);
    const credPayloads = credKeys.map((key) => JSON.stringify(snapshot.authCredentials[key]));

    if (userIds.length === 0) {
      await runner.query(`DELETE FROM ${usersTable}`);
    } else {
      await runner.query(`DELETE FROM ${usersTable} WHERE id <> ALL($1::text[])`, [userIds]);
      await runner.query(
        `INSERT INTO ${usersTable} (id, payload)
         SELECT id, payload::jsonb
         FROM UNNEST($1::text[], $2::text[]) AS t(id, payload)
         ON CONFLICT(id) DO UPDATE SET payload = EXCLUDED.payload`,
        [userIds, userPayloads],
      );
    }

    if (credKeys.length === 0) {
      await runner.query(`DELETE FROM ${credTable}`);
    } else {
      await runner.query(`DELETE FROM ${credTable} WHERE username <> ALL($1::text[])`, [credKeys]);
      await runner.query(
        `INSERT INTO ${credTable} (username, payload)
         SELECT username, payload::jsonb
         FROM UNNEST($1::text[], $2::text[]) AS t(username, payload)
         ON CONFLICT(username) DO UPDATE SET payload = EXCLUDED.payload`,
        [credKeys, credPayloads],
      );
    }
  }
}
