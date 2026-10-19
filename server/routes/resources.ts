/**
 * Resources: policies, processes and tutorials (Levi, 2026-10-19).
 *
 * Google Docs come from each company's Drive folder (subfolders = categories) and are read-only
 * here; "Open in Google Drive" sends people to the Doc, and Drive decides who may edit it. PDFs and
 * videos are uploaded here, and a resource can also be a plain link. company_id NULL = OMS-wide,
 * seen by every company. Everyone signed in can read their company's resources and the OMS-wide ones.
 *
 *   GET    /api/resources?q=                     list (q searches titles, descriptions and Doc text)
 *   GET    /api/resources/by-slug/:slug          one resource; own company's slug wins over OMS-wide
 *   GET    /api/files/:uploadId?exp=&sig=        a resource's PDF/video through a signed link (no sign-in
 *                                                header needed, so <video>/<iframe> can stream it)
 *   Resources admins (resources.manage in their company; OMS-wide: super admin):
 *   GET    /api/resources/admin                  folders, sync status, every resource incl. archived
 *   PUT    /api/resources/admin/source           { scope: company|oms, folder: link or id }
 *   POST   /api/resources/admin/sync             { scope }  "Sync now"
 *   POST   /api/resources                        { scope, kind: file|link, title, description?, category?, uploadId | url }
 *   PATCH  /api/resources/:id                    { slug?, title?, description?, category?, isActive? }
 *                                                (a Doc's title, description and category come from Drive)
 *
 * The folders also sync on their own every 10 minutes.
 */
import type express from "express";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { canAnywhereIn, type Access } from "../auth/permissions";
import { driveConfigured, folderIdFrom, folderName, serviceAccountEmail } from "../lib/googleDrive";
import { slugify, syncAll, syncSource, uniqueSlug } from "../lib/resources";
import { sendStoredFile } from "../lib/storage";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

// Signed file links last an hour. Set FILE_LINK_SECRET in production so links work across servers.
const LINK_TTL = 60 * 60;
const linkKey = createHmac("sha256", "file-links").update(process.env.FILE_LINK_SECRET?.trim() || process.env.HUB_JWT_SECRET?.trim() || randomBytes(32).toString("hex")).digest();
const sign = (uploadId: string, exp: number) => createHmac("sha256", linkKey).update(`${uploadId}.${exp}`).digest("base64url");
export function fileLink(uploadId: string): string {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL;
  return `/api/files/${uploadId}?exp=${exp}&sig=${sign(uploadId, exp)}`;
}

type Scope = "company" | "oms";
const isSuperAdmin = (a: Access) => a.grants.some((g) => g.permission === "system.admin" && g.scope.type === "global");
const canManage = (a: Access, scope: Scope) => (scope === "oms" ? isSuperAdmin(a) : canAnywhereIn(a, "resources.manage", a.companyId));
const scopeCompany = (a: Access, scope: Scope) => (scope === "oms" ? null : a.companyId);

const COLUMNS = `r.id, r.slug, r.kind, r.title, r.description, r.category, r.is_active,
  CASE WHEN r.company_id IS NULL THEN 'oms' ELSE 'company' END AS scope,
  coalesce(r.drive_modified_at, r.updated_at) AS updated_at, r.drive_file_id, r.url, r.upload_id, u.content_type`;
const FROM = "employee_hub.resources r LEFT JOIN employee_hub.uploads u ON u.id = r.upload_id";

const shape = (r: Record<string, any>) => ({
  id: r.id, slug: r.slug, kind: r.kind, title: r.title, description: r.description, category: r.category,
  scope: r.scope, updatedAt: r.updated_at, isActive: r.is_active,
  driveUrl: r.drive_file_id ? `https://docs.google.com/document/d/${r.drive_file_id}/edit` : null,
  url: r.url, contentType: r.content_type ?? null,
});

/** A short piece of the text around the first match, for search results. */
function snippet(text: string, q: string): string | null {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, i + q.length + 100).trim()}…`;
}

async function logActivity(a: Access, action: string, targetId: string | null, summary: string, after?: unknown) {
  await getProductDb().query(
    `INSERT INTO employee_hub.admin_activity (company_id, actor_id, action, target_type, target_id, summary, after)
     VALUES ($1,$2,$3,'resource',$4,$5,$6)`,
    [a.companyId, a.employeeId, action, targetId, summary, after === undefined ? null : JSON.stringify(after)]);
}

export function registerResourceRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    if (!current.access) return void fail(res, 403, "No employee profile for this account");
    return current.access;
  };

  if (driveConfigured()) {
    const run = () => syncAll(getProductDb()).catch((err) => console.error("[resources] sync failed:", (err as Error).message));
    setTimeout(run, 45_000).unref();
    setInterval(run, 10 * 60_000).unref();
  }

  app.get("/api/resources", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
      const args: unknown[] = [access.companyId];
      let match = "";
      if (q) {
        args.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        match = "AND (r.title ILIKE $2 OR r.description ILIKE $2 OR r.category ILIKE $2 OR r.search_text ILIKE $2)";
      }
      const { rows } = await getProductDb().query(
        `SELECT ${COLUMNS}${q ? ", r.search_text" : ""} FROM ${FROM}
          WHERE r.is_active AND (r.company_id IS NULL OR r.company_id = $1) ${match}
          ORDER BY r.category, r.title`, args);
      send(res, {
        items: rows.map((r) => ({ ...shape(r), snippet: q ? snippet(r.search_text ?? "", q) : null })),
        canManage: canManage(access, "company") || canManage(access, "oms"),
      });
    } catch (err) {
      fail(res, 500, `Could not load resources: ${(err as Error).message}`);
    }
  });

  app.get("/api/resources/by-slug/:slug", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const { rows } = await getProductDb().query(
        `SELECT ${COLUMNS}, r.content_html FROM ${FROM}
          WHERE r.slug = $1 AND r.is_active AND (r.company_id IS NULL OR r.company_id = $2)
          ORDER BY r.company_id IS NULL LIMIT 1`, [req.params.slug, access.companyId]);
      const r = rows[0];
      if (!r) return void fail(res, 404, "That resource doesn't exist or was removed.");
      send(res, { ...shape(r), html: r.content_html ?? null, fileUrl: r.upload_id ? fileLink(r.upload_id) : null });
    } catch (err) {
      fail(res, 500, `Could not load the resource: ${(err as Error).message}`);
    }
  });

  app.get("/api/files/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const exp = Number(req.query.exp);
      const given = Buffer.from(String(req.query.sig ?? ""));
      const expected = Buffer.from(/^[0-9a-f-]{36}$/i.test(id) && Number.isInteger(exp) ? sign(id, exp) : "");
      if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) return void fail(res, 403, "Invalid link");
      if (exp < Date.now() / 1000) return void fail(res, 410, "This link has expired. Reopen the resource.");
      const f = (await getProductDb().query("SELECT content_type, storage_key FROM employee_hub.uploads WHERE id = $1", [id])).rows[0];
      if (!f) return void fail(res, 404, "Not found");
      sendStoredFile(res, f.storage_key, f.content_type);
    } catch (err) {
      fail(res, 500, `Could not load file: ${(err as Error).message}`);
    }
  });

  // ---- Resources admins ----

  app.get("/api/resources/admin", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const scopes = (["company", "oms"] as Scope[]).filter((s) => canManage(access, s));
      if (!scopes.length) return void fail(res, 403, "Resources admins only");
      const db = getProductDb();
      const out = [];
      for (const scope of scopes) {
        const companyId = scopeCompany(access, scope);
        const source = (await db.query(
          "SELECT drive_folder_id, last_synced_at, last_result FROM employee_hub.resource_sources WHERE coalesce(company_id::text, 'oms') = coalesce($1::text, 'oms')",
          [companyId])).rows[0] ?? null;
        const items = (await db.query(
          `SELECT ${COLUMNS} FROM ${FROM} WHERE coalesce(r.company_id::text, 'oms') = coalesce($1::text, 'oms')
            ORDER BY r.is_active DESC, r.category, r.title`, [companyId])).rows.map(shape);
        out.push({
          scope,
          source: source && {
            folderId: source.drive_folder_id, folderUrl: `https://drive.google.com/drive/folders/${source.drive_folder_id}`,
            lastSyncedAt: source.last_synced_at, lastResult: source.last_result,
          },
          items,
        });
      }
      send(res, { driveConnected: driveConfigured(), serviceAccountEmail: serviceAccountEmail(), scopes: out });
    } catch (err) {
      fail(res, 500, `Could not load resources admin: ${(err as Error).message}`);
    }
  });

  const scopeParam = (v: unknown): Scope | null => (v === "company" || v === "oms" ? v : null);

  app.put("/api/resources/admin/source", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const scope = scopeParam(req.body?.scope);
      if (!scope || !canManage(access, scope)) return void fail(res, 403, "Resources admins only");
      const folderId = folderIdFrom(String(req.body?.folder ?? ""));
      if (!folderId) return void fail(res, 400, "Paste the Drive folder's link (drive.google.com/drive/folders/…).");
      let name: string | null = null;
      if (driveConfigured()) {
        try { name = await folderName(folderId); } catch (err) { return void fail(res, 400, `Can't open that folder: ${(err as Error).message}`); }
      }
      const companyId = scopeCompany(access, scope);
      const db = getProductDb();
      await db.query(
        `INSERT INTO employee_hub.resource_sources (company_id, drive_folder_id, updated_by_id) VALUES ($1,$2,$3)
         ON CONFLICT ((coalesce(company_id::text, 'oms'))) DO UPDATE
         SET drive_folder_id = EXCLUDED.drive_folder_id, updated_by_id = EXCLUDED.updated_by_id, updated_at = now(), last_result = NULL`,
        [companyId, folderId, access.employeeId]);
      await logActivity(access, "resources.source", null, `Set the ${scope === "oms" ? "OMS-wide" : "company"} Resources folder${name ? ` to "${name}"` : ""}`, { folderId });
      send(res, { folderId, name });
    } catch (err) {
      fail(res, 500, `Could not save the folder: ${(err as Error).message}`);
    }
  });

  app.post("/api/resources/admin/sync", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const scope = scopeParam(req.body?.scope);
      if (!scope || !canManage(access, scope)) return void fail(res, 403, "Resources admins only");
      if (!driveConfigured()) return void fail(res, 503, "Google Drive isn't connected on this server yet.");
      const db = getProductDb();
      const source = (await db.query(
        "SELECT id FROM employee_hub.resource_sources WHERE coalesce(company_id::text, 'oms') = coalesce($1::text, 'oms')",
        [scopeCompany(access, scope)])).rows[0];
      if (!source) return void fail(res, 400, "Connect a Drive folder first.");
      send(res, await syncSource(db, source.id));
    } catch (err) {
      fail(res, 500, `Sync failed: ${(err as Error).message}`);
    }
  });

  const cleanText = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  app.post("/api/resources", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const b = req.body ?? {};
      const scope = scopeParam(b.scope);
      if (!scope || !canManage(access, scope)) return void fail(res, 403, "Resources admins only");
      const title = cleanText(b.title, 200);
      if (!title) return void fail(res, 400, "Give it a title.");
      const companyId = scopeCompany(access, scope);
      const db = getProductDb();
      let uploadId: string | null = null;
      let url: string | null = null;
      if (b.kind === "file") {
        const up = (await db.query(
          "SELECT id FROM employee_hub.uploads WHERE id = $1 AND purpose = 'resource' AND company_id = $2",
          [/^[0-9a-f-]{36}$/i.test(String(b.uploadId)) ? b.uploadId : null, access.companyId])).rows[0];
        if (!up) return void fail(res, 400, "Upload the PDF or video first.");
        uploadId = up.id;
      } else if (b.kind === "link") {
        url = cleanText(b.url, 2000);
        if (!/^https?:\/\/\S+$/.test(url)) return void fail(res, 400, "Links must start with https://");
      } else {
        return void fail(res, 400, "Docs come from the Drive folder; here you can add a file or a link.");
      }
      const taken = new Set((await db.query(
        "SELECT slug FROM employee_hub.resources WHERE coalesce(company_id::text, 'oms') = coalesce($1::text, 'oms')", [companyId])).rows.map((r) => r.slug as string));
      const slug = uniqueSlug(slugify(title), taken);
      const description = cleanText(b.description, 500) || null;
      const { rows } = await db.query(
        `INSERT INTO employee_hub.resources (company_id, slug, kind, title, description, category, upload_id, url, search_text, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [companyId, slug, b.kind, title, description, cleanText(b.category, 60) || "General", uploadId, url, [title, description].filter(Boolean).join(" "), access.employeeId]);
      await logActivity(access, "resources.add", rows[0].id, `Added the ${b.kind} "${title}" to Resources`);
      send(res, { id: rows[0].id, slug });
    } catch (err) {
      fail(res, 500, `Could not add the resource: ${(err as Error).message}`);
    }
  });

  app.patch("/api/resources/:id", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return void fail(res, 404, "Not found");
      const db = getProductDb();
      const r = (await db.query("SELECT id, company_id, kind, slug, title, description, category, is_active FROM employee_hub.resources WHERE id = $1", [req.params.id])).rows[0];
      if (!r) return void fail(res, 404, "Not found");
      const scope: Scope = r.company_id === null ? "oms" : "company";
      if (!canManage(access, scope) || (scope === "company" && r.company_id !== access.companyId)) return void fail(res, 403, "Resources admins only");
      const b = req.body ?? {};
      const next = { slug: r.slug, title: r.title, description: r.description, category: r.category, is_active: r.is_active };
      if (b.slug !== undefined) {
        const slug = slugify(String(b.slug));
        const clash = (await db.query(
          "SELECT 1 FROM employee_hub.resources WHERE slug = $1 AND id <> $2 AND coalesce(company_id::text, 'oms') = coalesce($3::text, 'oms')",
          [slug, r.id, r.company_id])).rowCount;
        if (clash) return void fail(res, 409, `/resources/${slug} is already taken.`);
        next.slug = slug;
      }
      if (r.kind === "doc" && (b.title !== undefined || b.description !== undefined || b.category !== undefined || b.isActive !== undefined)) {
        return void fail(res, 400, "A Doc's title, description, folder and removal are managed in Google Drive.");
      }
      if (b.title !== undefined) next.title = cleanText(b.title, 200) || r.title;
      if (b.description !== undefined) next.description = cleanText(b.description, 500) || null;
      if (b.category !== undefined) next.category = cleanText(b.category, 60) || "General";
      if (b.isActive !== undefined) next.is_active = !!b.isActive;
      await db.query(
        `UPDATE employee_hub.resources SET slug = $2, title = $3, description = $4, category = $5, is_active = $6, updated_at = now(),
                search_text = CASE WHEN kind = 'doc' THEN search_text ELSE concat_ws(' ', $3::text, $4::text) END
          WHERE id = $1`,
        [r.id, next.slug, next.title, next.description, next.category, next.is_active]);
      await logActivity(access, "resources.update", r.id, `Updated "${next.title}" in Resources`, next);
      send(res, next);
    } catch (err) {
      fail(res, 500, `Could not update the resource: ${(err as Error).message}`);
    }
  });
}
