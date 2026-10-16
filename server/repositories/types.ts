import type { User } from "../../src/types";

export type AppStateSnapshot = {
  users: User[];
  authCredentials: Record<string, { userId: string; passwordHash: string }>;
};

export type StateRepository = {
  load: () => Promise<AppStateSnapshot>;
  save: (snapshot: AppStateSnapshot) => Promise<void>;
};
