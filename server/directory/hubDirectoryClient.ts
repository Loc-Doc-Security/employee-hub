import type { ItRole } from "../../src/types";

export type HubDirectoryEntry = {
  id: string;
  email: string;
  name: string;
  active: boolean;
  department?: string;
  branch?: string;
  managerScope?: string;
  itRole?: ItRole;
  canAccessPm?: boolean;
  canAccessIt?: boolean;
  headshotUrl?: string;
};

function hubBaseUrl(): string {
  return (process.env.HUB_APP_URL ?? "http://localhost:3002").replace(/\/$/, "");
}

async function hubGet<T>(path: string, token: string): Promise<T | null> {
  const res = await fetch(`${hubBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { ok: boolean; data?: T };
  return json.ok && json.data !== undefined ? json.data : null;
}

export async function fetchDirectoryEntry(hubUserId: string, token: string): Promise<HubDirectoryEntry | null> {
  return hubGet<HubDirectoryEntry>(`/api/directory/employees/${encodeURIComponent(hubUserId)}`, token);
}

export async function fetchDirectoryEmployees(token: string): Promise<HubDirectoryEntry[] | null> {
  return hubGet<HubDirectoryEntry[]>("/api/directory/employees", token);
}
