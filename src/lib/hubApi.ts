// Employee Hub API calls. Same envelope handling as lib/api.ts, plus the local-dev "View as" header
// so every screen acts as the employee picked in ViewAsPicker.
import { useEffect, useState } from "react";
import { getAuthToken } from "./authToken";

const VIEW_AS_KEY = "employee-hub:view-as";

export function getViewAs(): string {
  try {
    return localStorage.getItem(VIEW_AS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setViewAs(employeeId: string) {
  try {
    if (employeeId) localStorage.setItem(VIEW_AS_KEY, employeeId);
    else localStorage.removeItem(VIEW_AS_KEY);
  } catch {
    /* storage blocked: picker just won't persist */
  }
  window.location.reload();
}

async function hubRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const viewAs = getViewAs();
  if (viewAs) headers.set("x-view-as", viewAs);
  const res = await fetch(url, { ...init, headers });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json.data as T;
}

export const hubGet = <T,>(url: string) => hubRequest<T>(url);
export const hubPost = <T,>(url: string, body: unknown) =>
  hubRequest<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type Reach = { all: boolean; companyIds: string[]; departmentIds: string[] };
export type Me = {
  employee: { id: string; first_name: string; last_name: string; email: string; company_id: string; company: string } | null;
  permissions: Record<string, Reach>;
  viewAs: { active: boolean; options: { id: string; name: string; roles: string }[] } | null;
};

/** The signed-in (or viewed-as) employee and what they can do. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    hubGet<Me>("/api/me").then(setMe).catch((e: Error) => setError(e.message));
  }, []);
  return { me, error };
}
