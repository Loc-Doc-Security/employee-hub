// Read-only Google access, as a Google service account (a robot Google account the hub signs in
// as): Drive for Resources, Sheets for the credit card sync. Each folder or Sheet is shared with the
// service account's email as Viewer; it can't see anything else.
//
// Credentials: GOOGLE_SERVICE_ACCOUNT_JSON (the key file's contents) or GOOGLE_SERVICE_ACCOUNT_FILE
// (a path to it). Without either, Drive features report "not connected" and nothing else breaks.
//
// Plain fetch + Node crypto, so no Google client library is needed.
import { createSign } from "crypto";
import { readFileSync } from "fs";

const SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly";
const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const SHORTCUT = "application/vnd.google-apps.shortcut";

type Key = { client_email: string; private_key: string; token_uri?: string };

let cachedKey: Key | null | undefined;
function key(): Key | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
    || (process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim() ? readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE.trim(), "utf8") : "");
  if (!raw) return (cachedKey = null);
  if (process.env.NODE_ENV === "production" && process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim()) {
    console.warn("[google] Using a key FILE in production. Move it to AWS Secrets Manager as GOOGLE_SERVICE_ACCOUNT_JSON (see GO-LIVE.md).");
  }
  const k = JSON.parse(raw) as Key;
  if (!k.client_email || !k.private_key) throw new Error("The Google service account key is missing client_email or private_key.");
  return (cachedKey = k);
}

export const driveConfigured = () => !!key();
export const serviceAccountEmail = () => key()?.client_email ?? null;

let token: { value: string; expires: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const k = key();
  if (!k) throw new Error("Google Drive isn't connected (no service account key on the server).");
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const aud = k.token_uri ?? "https://oauth2.googleapis.com/token";
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: k.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(k.private_key).toString("base64url");
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await res.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description ?? res.status}`);
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function drive(pathAndQuery: string, base = API): Promise<Response> {
  const res = await fetch(`${base}${pathAndQuery}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 404) throw new Error(`Not found, or not shared with ${serviceAccountEmail()}.`);
  if (!res.ok) {
    const raw = await res.text();
    let message = raw.slice(0, 200);
    try { message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? message; } catch { /* not JSON */ }
    if (/cannot be exported/i.test(message)) {
      throw new Error(`Drive won't let the hub read this Doc because its sharing stops viewers from downloading or copying. Give ${serviceAccountEmail()} Editor access (the hub still can only read), or turn that option off.`);
    }
    if (res.status === 403) throw new Error(`No access. Share it with ${serviceAccountEmail()}. (${message})`);
    throw new Error(`Google error ${res.status}: ${message}`);
  }
  return res;
}

type DriveFile = {
  id: string; name: string; mimeType: string; modifiedTime: string; description?: string;
  shortcutDetails?: { targetId: string; targetMimeType: string };
};

export async function folderName(folderId: string): Promise<string> {
  const f = await (await drive(`/files/${encodeURIComponent(folderId)}?fields=name,mimeType&supportsAllDrives=true`)).json() as DriveFile;
  if (f.mimeType !== FOLDER) throw new Error("That link is a file, not a folder.");
  return f.name;
}

async function children(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent("nextPageToken, files(id, name, mimeType, modifiedTime, description, shortcutDetails)");
    const page = await (await drive(`/files?q=${q}&fields=${fields}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`)).json() as { files: DriveFile[]; nextPageToken?: string };
    out.push(...page.files);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

export type FolderDoc = { id: string; name: string; modifiedTime: string; description: string; category: string };
export type Skipped = { name: string; reason: string };

/**
 * Every Google Doc in the folder. Docs directly in it are "General"; docs in a subfolder (at any
 * depth) take the top-level subfolder's name as their category. Shortcuts to Docs count. Anything
 * else (PDFs, videos, Sheets…) is reported as skipped, since those are uploaded in the hub instead.
 */
export async function docsInFolder(rootId: string): Promise<{ docs: FolderDoc[]; skipped: Skipped[] }> {
  const docs: FolderDoc[] = [];
  const skipped: Skipped[] = [];
  const seenFolders = new Set<string>([rootId]);
  const walk = async (folderId: string, category: string | null) => {
    for (const f of await children(folderId)) {
      if (f.mimeType === FOLDER) {
        if (seenFolders.has(f.id)) continue;
        seenFolders.add(f.id);
        await walk(f.id, category ?? f.name.trim());
      } else if (f.mimeType === DOC || (f.mimeType === SHORTCUT && f.shortcutDetails?.targetMimeType === DOC)) {
        const id = f.mimeType === SHORTCUT ? f.shortcutDetails!.targetId : f.id;
        if (docs.some((d) => d.id === id)) continue;
        let target = f;
        if (f.mimeType === SHORTCUT) {
          try {
            target = await (await drive(`/files/${id}?fields=id,name,mimeType,modifiedTime,description&supportsAllDrives=true`)).json() as DriveFile;
          } catch (err) {
            skipped.push({ name: f.name, reason: `Shortcut to a Doc that can't be opened: ${(err as Error).message}` });
            continue;
          }
        }
        docs.push({ id, name: target.name.trim(), modifiedTime: target.modifiedTime, description: target.description?.trim() ?? "", category: category ?? "General" });
      } else {
        skipped.push({ name: f.name, reason: "Not a Google Doc. Upload PDFs and videos on the Resources page instead." });
      }
    }
  };
  await walk(rootId, null);
  return { docs, skipped };
}

export async function docHtml(docId: string): Promise<string> {
  return (await drive(`/files/${encodeURIComponent(docId)}/export?mimeType=text%2Fhtml`)).text();
}

/** Accepts a folder link or a bare folder id. */
export function folderIdFrom(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

/** A tab's cells as plain values (gid = the tab from the link; null = the first tab). */
export async function sheetValues(sheetId: string, gid: string | null): Promise<{ tab: string; values: unknown[][] }> {
  const id = encodeURIComponent(sheetId);
  const meta = await (await drive(`/${id}?fields=sheets.properties(sheetId,title)`, SHEETS)).json() as { sheets: { properties: { sheetId: number; title: string } }[] };
  const tab = (gid === null ? meta.sheets[0] : meta.sheets.find((x) => String(x.properties.sheetId) === gid))?.properties.title;
  if (!tab) throw new Error("That tab isn't in the Sheet anymore. Paste the Sheet link again.");
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:Z1000`);
  const body = await (await drive(`/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`, SHEETS)).json() as { values?: unknown[][] };
  return { tab, values: body.values ?? [] };
}
