import { readFileSync } from "node:fs";
import path from "node:path";
import type { AppStateSnapshot } from "../repositories/types";

export function loadInitialSeedFile(): AppStateSnapshot {
  const seedPath = path.join(
    process.cwd(),
    process.env.NODE_ENV === "production"
      ? "server/data/initial-seed.production.json"
      : "server/data/initial-seed.json",
  );
  return JSON.parse(readFileSync(seedPath, "utf-8")) as AppStateSnapshot;
}