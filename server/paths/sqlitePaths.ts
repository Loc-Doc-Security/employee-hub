import path from "path";

export const LOCAL_DEV_SQLITE_FILENAME = "employee-hub-data.sqlite";
export const PRODUCTION_EFS_SQLITE_PATH = "/mnt/efs/employee-hub-data.sqlite";

export function resolveSqliteDbPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  if (env.NODE_ENV === "production") {
    const fromEnv = env.SQLITE_DB_PATH?.trim();
    if (!fromEnv) throw new Error(`Production requires SQLITE_DB_PATH (${PRODUCTION_EFS_SQLITE_PATH})`);
    return path.resolve(fromEnv);
  }
  const fromEnv = env.SQLITE_DB_PATH?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(cwd, LOCAL_DEV_SQLITE_FILENAME);
}