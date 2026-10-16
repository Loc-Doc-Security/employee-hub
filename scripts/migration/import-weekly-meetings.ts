/**
 * Imports Wix WeeklyAgendas into weekly_meetings (company: Loc-Doc). Run after import-employees.
 * The typed presenter name is matched to an employee (case/space-insensitive); no match (former
 * employees, "-" placeholders) keeps the text in presenter_name_legacy. Non-https links are dropped
 * (counted). Keeps Wix ids; safe to re-run. One transaction.
 *
 * Usage: npx tsx scripts/migration/import-weekly-meetings.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows: Row[] = JSON.parse(await readFile(path.join(exportDir, "collections", "WeeklyAgendas.json"), "utf8"));
  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { read: rows.length, imported: 0, presenterMatched: 0, presenterKeptAsText: 0, noPresenter: 0, linksDropped: 0, skipped: 0 };
  const unmatched = new Set<string>();
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const byName = new Map((await db.query("SELECT id, first_name || ' ' || last_name AS name FROM employees")).rows.map((r) => [norm(r.name), r.id as string]));

    for (const r of rows) {
      const raw = r.date as { $date?: string } | string;
      const date = (typeof raw === "object" && raw?.$date ? raw.$date : text(raw)).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).getUTCDay() !== 3) { n.skipped++; continue; }
      const typed = /^[-–—\s]*$/.test(text(r.techSpotlight)) ? "" : text(r.techSpotlight); // "-" = no presenter
      const presenterId = typed ? byName.get(norm(typed)) ?? null : null;
      if (presenterId) n.presenterMatched++;
      else if (typed) { n.presenterKeptAsText++; unmatched.add(typed); }
      else n.noPresenter++;
      let url: string | null = text(r.presentationUrl) || null;
      if (url && !url.startsWith("https://")) { url = null; n.linksDropped++; }
      const type = url ? (text(r.presentationType) === "external" ? "external" : /docs\.google\.com\/presentation/.test(url) ? "slides" : text(r.presentationType) === "slides" ? "slides" : "external") : null;
      await db.query(
        `INSERT INTO weekly_meetings (id, company_id, meeting_on, topic, presenter_id, presenter_name_legacy, presentation_url, presentation_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET meeting_on = EXCLUDED.meeting_on, topic = EXCLUDED.topic, presenter_id = EXCLUDED.presenter_id,
           presenter_name_legacy = EXCLUDED.presenter_name_legacy, presentation_url = EXCLUDED.presentation_url,
           presentation_type = EXCLUDED.presentation_type, updated_at = now()`,
        [r._id, company.id, date, text(r.topic), presenterId, presenterId ? null : typed || null, url, type],
      );
      n.imported++;
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
  console.log(`Imported from ${exportDir}`);
  console.log(`  read ${n.read}, imported ${n.imported} (skipped ${n.skipped} not on a Wednesday)`);
  console.log(`  presenter: ${n.presenterMatched} matched, ${n.presenterKeptAsText} kept as typed text (${[...unmatched].join(", ")}), ${n.noPresenter} none`);
  console.log(`  links dropped (not https): ${n.linksDropped}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
