// Resources: slugs, Google Doc HTML cleanup, and the Drive folder sync.
import type pg from "pg";
import { docHtml, docsInFolder, type Skipped } from "./googleDrive";

/** "Holidays SOP" → "holidays-sop". */
export function slugify(title: string): string {
  const s = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "resource";
}

/** First free slug: base, base-2, base-3… */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Google's HTML export of a Doc, made safe to show. It's displayed in a sandboxed frame with scripts
 * off, so this is a second line of defence: drop anything active, unwrap Google's link redirects
 * (google.com/url?q=…), and open links in a new tab.
 */
export function cleanDocHtml(html: string): string {
  let out = html
    .replace(/<(script|iframe|object|embed|form|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|iframe|object|embed|form|noscript|template|meta|link|base)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"')
    .replace(/href="https:\/\/www\.google\.com\/url\?q=([^"&]+)[^"]*"/g, (_m, q: string) => {
      try { return `href="${decodeURIComponent(q.replace(/&amp;/g, "&")).replace(/"/g, "%22")}"`; } catch { return `href="${q}"`; }
    });
  const head = '<base target="_blank"><meta charset="utf-8"><style>body{max-width:none!important;padding:24px!important;margin:0}img{max-width:100%;height:auto}</style>';
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head([^>]*)>/i, `<head$1>${head}`) : `<!doctype html><html><head>${head}</head><body>${out}</body></html>`;
  return out;
}

/** Plain text of an HTML page, for search. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ").trim();
}

export type SyncResult = { added: number; updated: number; unchanged: number; archived: number; skipped: Skipped[] };

const running = new Set<string>();

/**
 * Mirrors one Drive folder into resources for its company (null = OMS-wide). New Docs are added,
 * changed ones re-exported, ones no longer in the folder archived (never deleted, so their address
 * keeps working if they come back). Docs imported from Wix are picked up by their Drive id.
 */
export async function syncSource(db: pg.Pool, sourceId: string): Promise<SyncResult> {
  if (running.has(sourceId)) throw new Error("A sync of this folder is already running.");
  running.add(sourceId);
  try {
    const source = (await db.query("SELECT id, company_id, drive_folder_id FROM employee_hub.resource_sources WHERE id = $1", [sourceId])).rows[0];
    if (!source) throw new Error("Unknown Resources folder.");
    const companyId: string | null = source.company_id;
    let result: SyncResult;
    try {
      result = await mirror(db, companyId, source.drive_folder_id);
    } catch (err) {
      await db.query("UPDATE employee_hub.resource_sources SET last_synced_at = now(), last_result = $2 WHERE id = $1",
        [sourceId, JSON.stringify({ error: (err as Error).message })]);
      throw err;
    }
    await db.query("UPDATE employee_hub.resource_sources SET last_synced_at = now(), last_result = $2 WHERE id = $1", [sourceId, JSON.stringify(result)]);
    return result;
  } finally {
    running.delete(sourceId);
  }
}

async function mirror(db: pg.Pool, companyId: string | null, folderId: string): Promise<SyncResult> {
  const { docs, skipped } = await docsInFolder(folderId);
  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, archived: 0, skipped };
  const sameScope = "coalesce(company_id::text, 'oms') = coalesce($1::text, 'oms')";
  const existing = new Map((await db.query(
    "SELECT id, company_id, drive_file_id, drive_modified_at, title, category, description, is_active FROM employee_hub.resources WHERE drive_file_id = ANY($1::text[])",
    [docs.map((d) => d.id)])).rows.map((r) => [r.drive_file_id as string, r]));
  const taken = new Set((await db.query(`SELECT slug FROM employee_hub.resources WHERE ${sameScope}`, [companyId])).rows.map((r) => r.slug as string));

  for (const d of docs) {
    const row = existing.get(d.id);
    if (row && (row.company_id ?? null) !== companyId) {
      skipped.push({ name: d.name, reason: "This Doc is already in another company's Resources folder." });
      continue;
    }
    const modified = new Date(d.modifiedTime);
    const contentChanged = !row || !row.drive_modified_at || new Date(row.drive_modified_at) < modified;
    if (row && !contentChanged && row.is_active && row.title === d.name && row.category === d.category
        && (!d.description || row.description === d.description)) {
      result.unchanged++;
      continue;
    }
    let html: string | null = null;
    if (contentChanged) {
      try {
        html = cleanDocHtml(await docHtml(d.id));
      } catch (err) {
        skipped.push({ name: d.name, reason: `Couldn't read it: ${(err as Error).message}` });
        continue;
      }
    }
    if (row) {
      await db.query(
        `UPDATE employee_hub.resources SET title = $2, category = $3, description = coalesce(nullif($4, ''), description),
                content_html = coalesce($5, content_html), search_text = coalesce($6, search_text),
                drive_modified_at = $7, is_active = true, source = 'drive', updated_at = now()
          WHERE id = $1`,
        [row.id, d.name, d.category, d.description, html, html === null ? null : htmlToText(html), modified]);
      result.updated++;
    } else {
      const slug = uniqueSlug(slugify(d.name), taken);
      taken.add(slug);
      await db.query(
        `INSERT INTO employee_hub.resources (company_id, slug, kind, title, description, category, drive_file_id, drive_modified_at, content_html, search_text, source)
         VALUES ($1,$2,'doc',$3,nullif($4, ''),$5,$6,$7,$8,$9,'drive')`,
        [companyId, slug, d.name, d.description, d.category, d.id, modified, html, htmlToText(html!)]);
      result.added++;
    }
  }

  const archived = await db.query(
    `UPDATE employee_hub.resources SET is_active = false, updated_at = now()
      WHERE ${sameScope} AND kind = 'doc' AND is_active AND NOT (drive_file_id = ANY($2::text[]))`,
    [companyId, docs.map((d) => d.id)]);
  result.archived = archived.rowCount ?? 0;
  return result;
}

/** Syncs every connected folder. Used by the timer; errors are recorded per folder. */
export async function syncAll(db: pg.Pool): Promise<void> {
  for (const { id } of (await db.query("SELECT id FROM employee_hub.resource_sources")).rows) {
    await syncSource(db, id).catch((err) => console.error("[resources] sync failed:", (err as Error).message));
  }
}
