import { PostgresRepository } from "./postgresRepository";
import { SqliteRepository } from "./sqliteRepository";
import type { AppStateSnapshot, StateRepository } from "./types";
import { resolveSqliteDbPath } from "../paths/sqlitePaths";

function snapshotHasData(snapshot: AppStateSnapshot): boolean {
  return snapshot.users.length > 0 || Object.keys(snapshot.authCredentials).length > 0;
}

/**
 * App state repository.
 * Default `npm run dev` is SQLite (this app's own file).
 * `DATA_BACKEND=postgres` uses a dedicated schema on the shared Lab database
 * (`npm run dev:postgres` locally, or RDS in production).
 */
export async function createRepository(initial: AppStateSnapshot): Promise<StateRepository> {
  const backend = (process.env.DATA_BACKEND?.toLowerCase().trim() || "sqlite") as string;

  if (backend === "postgres") {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error("DATA_BACKEND=postgres requires DATABASE_URL");
    }
    const repo = new PostgresRepository(url);
    const loaded = await repo.load();
    if (!snapshotHasData(loaded)) {
      await repo.save(initial);
    }
    console.info(`[postgres] schema=${repo.getSchema()} connected`);
    return repo;
  }

  const dbPath = resolveSqliteDbPath();
  console.info(`[sqlite] database file: ${dbPath}`);
  const repo = new SqliteRepository(dbPath);
  const loaded = await repo.load();
  if (!snapshotHasData(loaded)) {
    await repo.save(initial);
  }
  return repo;
}
