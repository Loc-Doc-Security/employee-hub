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

export const hubPut = <T,>(url: string, body: unknown) =>
  hubRequest<T>(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const hubPatch = <T,>(url: string, body: unknown) =>
  hubRequest<T>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const hubDelete = <T,>(url: string, body: unknown) =>
  hubRequest<T>(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Uploads one image (already shrunk by the caller); retries a couple of times on network hiccups. */
export async function hubUpload(blob: Blob, purpose: string, attempts = 3): Promise<string> {
  let last: Error = new Error("Upload failed");
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await hubRequest<{ id: string }>(`/api/uploads?purpose=${encodeURIComponent(purpose)}`, {
        method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob,
      });
      return r.id;
    } catch (e) {
      last = e as Error;
      if (/isn't a JPEG|415|403|401/.test(last.message)) break; // not worth retrying
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    }
  }
  throw last;
}

/** An uploaded image as an object URL. <img src> can't send the sign-in header, so fetch it. */
export function useUploadUrl(id: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let revoke: string | null = null;
    const headers = new Headers();
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const viewAs = getViewAs();
    if (viewAs) headers.set("x-view-as", viewAs);
    fetch(`/api/uploads/${id}`, { headers })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) { revoke = URL.createObjectURL(b); setUrl(revoke); } })
      .catch(() => setUrl(null));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [id]);
  return url;
}

/** Shrinks a phone photo before upload: longest side ≤ maxSide, JPEG. */
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("Could not process photo"))), "image/jpeg", quality));
}
