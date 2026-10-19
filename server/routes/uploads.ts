/**
 * Photo uploads. Each photo is uploaded on its own as soon as it's taken (the browser shrinks it
 * first), so a flaky connection only ever retries one photo, never the whole audit.
 *
 *   POST /api/uploads?purpose=cleanliness|spotlight|catalog   raw image body (JPEG/PNG/WebP, ≤ 12 MB) → { id }
 *        (catalog photos: Shop Admins only)
 *   POST /api/uploads?purpose=resource       a PDF or video (MP4/MOV/WebM, ≤ 300 MB); Resources admins only
 *   GET  /api/uploads/:id                    the image, if the caller may see it
 *
 * Who may see a photo: the person who uploaded it; for cleanliness photos, anyone in the same company
 * who can view the cleanliness report or edit audits; for spotlight photos, anyone in the same
 * company (the spotlight showcase is open to everyone); for catalog photos, anyone signed in (the
 * catalog is shared by every company); for resource files, anyone who can see a resource using it
 * (pages normally open those through a signed link instead; see routes/resources.ts).
 */
import express from "express";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { can, canAnywhereIn } from "../auth/permissions";
import { loadFile, saveFile, sniffDocument, sniffImage } from "../lib/storage";

const PURPOSES = new Set(["cleanliness", "spotlight", "catalog", "resource"]);
const IMAGE_LIMIT = 12 * 1024 * 1024;
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });

export function registerUploadRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  app.post("/api/uploads", express.raw({ type: () => true, limit: "300mb" }), async (req, res) => {
    try {
      const current = await resolveCurrent(req, getAuthUser);
      if (!current) return void fail(res, 401, "Sign in required");
      const access = current.access;
      if (!access) return void fail(res, 403, "No employee profile for this account");
      const purpose = String(req.query.purpose ?? "");
      if (!PURPOSES.has(purpose)) return void fail(res, 400, "Unknown upload purpose");
      if (purpose === "catalog" && !access.grants.some((g) => g.permission === "shop.admin")) return void fail(res, 403, "Shop Admins only");
      if (purpose === "resource" && !canAnywhereIn(access, "resources.manage", access.companyId)) return void fail(res, 403, "Resources admins only");
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const kind = purpose === "resource" ? sniffDocument(bytes) : sniffImage(bytes);
      if (!kind) return void fail(res, 415, purpose === "resource" ? "That file isn't a PDF or an MP4, MOV or WebM video." : "That file isn't a JPEG, PNG or WebP image.");
      if (purpose !== "resource" && bytes.length > IMAGE_LIMIT) return void fail(res, 413, "Images can be at most 12 MB.");
      const key = await saveFile(bytes, kind.ext);
      const { rows } = await getProductDb().query(
        `INSERT INTO employee_hub.uploads (company_id, uploaded_by_id, purpose, content_type, byte_size, storage_key)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [access.companyId, access.employeeId, purpose, kind.contentType, bytes.length, key],
      );
      res.json({ ok: true, data: { id: rows[0].id } });
    } catch (err) {
      fail(res, 500, `Upload failed: ${(err as Error).message}`);
    }
  });

  app.get("/api/uploads/:id", async (req, res) => {
    try {
      const current = await resolveCurrent(req, getAuthUser);
      if (!current) return void fail(res, 401, "Sign in required");
      const access = current.access;
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return void fail(res, 404, "Not found");
      const { rows } = await getProductDb().query(
        "SELECT company_id, uploaded_by_id, purpose, content_type, storage_key FROM employee_hub.uploads WHERE id = $1",
        [req.params.id],
      );
      const f = rows[0];
      if (!f) return void fail(res, 404, "Not found");
      const target = { companyId: f.company_id };
      const allowed = access && (f.uploaded_by_id === access.employeeId
        || (f.purpose === "spotlight" && access.companyId === f.company_id)
        || f.purpose === "catalog"
        || (f.purpose === "resource" && (await getProductDb().query(
          "SELECT 1 FROM employee_hub.resources WHERE upload_id = $1 AND is_active AND (company_id IS NULL OR company_id = $2)",
          [req.params.id, access.companyId])).rowCount)
        || can(access, "cleanliness.view_report", target) || can(access, "cleanliness.edit_any", target)
        || access.grants.some((g) => g.permission === "cleanliness.view_report" && g.scope.type === "department" && g.scope.companyId === f.company_id));
      if (!allowed) return void fail(res, 403, "Not allowed");
      res.setHeader("Content-Type", f.content_type);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(await loadFile(f.storage_key));
    } catch (err) {
      fail(res, 500, `Could not load file: ${(err as Error).message}`);
    }
  });
}
