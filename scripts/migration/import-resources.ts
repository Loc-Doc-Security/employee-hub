/**
 * Imports Wix ProcessPoliciesTutorials into resources (company: Loc-Doc). Run after import-employees.
 * Docs keep their Google Doc id, so the first Drive sync takes them over and re-exports them from
 * Drive (drive_modified_at is left empty on purpose). Until then the HTML n8n stored in Wix is shown.
 * PDFs were Drive files; they come in as links to Drive and are listed so they can be re-uploaded
 * (PDFs are uploads in the hub now). Keeps Wix ids and slugs; safe to re-run.
 *
 * Usage: npx tsx scripts/migration/import-resources.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";
import { cleanDocHtml, htmlToText, slugify, uniqueSlug } from "../../server/lib/resources";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows: Row[] = JSON.parse(await readFile(path.join(exportDir, "collections", "ProcessPoliciesTutorials.json"), "utf8"));
  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { read: rows.length, docs: 0, pdfLinks: [] as string[], skippedNoDoc: [] as string[] };
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const existing = new Map((await db.query("SELECT id, slug FROM resources WHERE company_id = $1", [company.id])).rows.map((r) => [r.id as string, r.slug as string]));
    const taken = new Set(existing.values());

    for (const r of rows) {
      const title = text(r.title);
      const category = text(r.category) || "General";
      const description = text(r.description) || null;
      const active = r.isActive !== false;
      const slug = existing.get(r._id) ?? uniqueSlug(slugify(title.replace(/\.pdf$/i, "")), taken);
      taken.add(slug);
      const isPdf = text(r.fileType) === "pdf";
      if (isPdf) {
        const url = text(r.driveUrl);
        if (!url.startsWith("https://")) { n.skippedNoDoc.push(title); continue; }
        await db.query(
          `INSERT INTO resources (id, company_id, slug, kind, title, description, category, url, search_text, is_active, source)
           VALUES ($1,$2,$3,'link',$4,$5,$6,$7,$8,$9,'wix_import')
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category,
             url = EXCLUDED.url, search_text = EXCLUDED.search_text, is_active = EXCLUDED.is_active`,
          [r._id, company.id, slug, title, description, category, url, [title, description].filter(Boolean).join(" "), active]);
        n.pdfLinks.push(title);
        continue;
      }
      const docId = text(r.googleDocId);
      if (!docId) { n.skippedNoDoc.push(title); continue; }
      const html = text(r.contentHTML) ? cleanDocHtml(text(r.contentHTML)) : null;
      await db.query(
        `INSERT INTO resources (id, company_id, slug, kind, title, description, category, drive_file_id, content_html, search_text, is_active, source)
         VALUES ($1,$2,$3,'doc',$4,$5,$6,$7,$8,$9,$10,'wix_import')
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category,
           drive_file_id = EXCLUDED.drive_file_id, content_html = EXCLUDED.content_html, search_text = EXCLUDED.search_text,
           is_active = EXCLUDED.is_active
         WHERE resources.source = 'wix_import'`,
        [r._id, company.id, slug, title, description, category, docId, html, html ? htmlToText(html) : title, active]);
      n.docs++;
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
  console.log(`Imported from ${exportDir}`);
  console.log(`  read ${n.read}, imported ${n.docs} Docs`);
  if (n.pdfLinks.length) console.log(`  PDFs imported as links to Drive (re-upload them on the Resources page): ${n.pdfLinks.join(", ")}`);
  if (n.skippedNoDoc.length) console.log(`  skipped (no Google Doc id or link): ${n.skippedNoDoc.join(", ")}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
