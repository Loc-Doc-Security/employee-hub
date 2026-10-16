import { DatabaseSync } from "node:sqlite";
import type { AppStateSnapshot, StateRepository } from "./types";

export class SqliteRepository implements StateRepository {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_credentials (username TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  }
  async load(): Promise<AppStateSnapshot> {
    const users = (this.db.prepare("SELECT payload FROM users").all() as { payload: string }[]).map(
      (r) => JSON.parse(r.payload) as AppStateSnapshot["users"][number],
    );
    const authCredentials: AppStateSnapshot["authCredentials"] = {};
    for (const row of this.db.prepare("SELECT username, payload FROM auth_credentials").all() as {
      username: string;
      payload: string;
    }[]) {
      authCredentials[row.username] = JSON.parse(row.payload);
    }
    return { users, authCredentials };
  }
  async save(snapshot: AppStateSnapshot): Promise<void> {
    this.db.exec("DELETE FROM users; DELETE FROM auth_credentials;");
    const iu = this.db.prepare("INSERT INTO users (id, payload) VALUES (?, ?)");
    for (const u of snapshot.users) iu.run(u.id, JSON.stringify(u));
    const ic = this.db.prepare("INSERT INTO auth_credentials (username, payload) VALUES (?, ?)");
    for (const [username, cred] of Object.entries(snapshot.authCredentials)) {
      ic.run(username, JSON.stringify(cred));
    }
  }
}