/**
 * Imports Wix AssessmentScores history into peer_assessments (company: Loc-Doc). Run after
 * import-employees.
 *
 * Subject: Wix subjectId → otherwise a former-employee name snapshot (`subject`).
 * Submitter: email → employee; otherwise a former-employee name/email snapshot.
 * Clean-up (all counted, never silent): any of the six scores blank or outside 1–4 → skipped;
 * the same submitter rating the same person twice in one month → the FIRST is kept (no-edit rule).
 * Old feedback was one combined text ("Hungry (4): …\n\n…"); it's kept as-is in general_feedback.
 *
 * Keeps each Wix _id as the row id; safe to re-run. One transaction.
 * Usage: npx tsx scripts/migration/import-peer-assessments.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, unknown> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const KEYS = ["humble", "hungry", "smart", "helpfulKind", "fastResponse", "solvesProblems"] as const;
const created = (r: Row) => {
  const c = r._createdDate as { $date?: string } | string | undefined;
  return (typeof c === "object" && c?.$date) || (typeof c === "string" ? c : "") || `${text(r.dateMonth)}T12:00:00Z`;
};

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows: Row[] = JSON.parse(await readFile(path.join(exportDir, "collections", "AssessmentScores.json"), "utf8"));
  rows.sort((a, b) => created(a).localeCompare(created(b)));

  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { read: rows.length, imported: 0, formerSubjects: 0, formerSubmitters: 0, skippedScores: 0, skippedDuplicate: 0, skippedSelf: 0 };
  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const emps = (await db.query("SELECT id, lower(email) AS email FROM employees")).rows as { id: string; email: string }[];
    const ids = new Set(emps.map((e) => e.id));
    const byEmail = new Map(emps.map((e) => [e.email, e.id]));
    const seen = new Set<string>();

    for (const r of rows) {
      const scores = KEYS.map((k) => Number(r[k]));
      if (scores.some((s) => !Number.isInteger(s) || s < 1 || s > 4)) { n.skippedScores++; continue; }

      const subjectId = ids.has(text(r.subjectId)) ? text(r.subjectId) : null;
      const subjectFormer = subjectId ? null : text(r.subject) || null;
      const email = text(r.email).toLowerCase();
      const submitterId = email && byEmail.has(email) ? byEmail.get(email)! : null;
      if (subjectId && subjectId === submitterId) { n.skippedSelf++; continue; }

      const day = text(r.dateMonth).slice(0, 10);
      const month = `${day.slice(0, 7)}-01`;
      const key = `${submitterId ?? email ?? text(r.submitter)}|${subjectId ?? subjectFormer}|${month}`;
      if (seen.has(key)) { n.skippedDuplicate++; continue; }
      seen.add(key);
      if (!subjectId) n.formerSubjects++;
      if (!submitterId) n.formerSubmitters++;

      await db.query(
        `INSERT INTO peer_assessments (id, company_id, month, assessed_on, subject_id, subject_former_name,
           submitted_by_id, submitter_former_name, submitter_former_email,
           humble, hungry, smart, helpful_kind, fast_response, solves_problems, general_feedback, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO UPDATE SET month = EXCLUDED.month, assessed_on = EXCLUDED.assessed_on,
           subject_id = EXCLUDED.subject_id, subject_former_name = EXCLUDED.subject_former_name,
           submitted_by_id = EXCLUDED.submitted_by_id, submitter_former_name = EXCLUDED.submitter_former_name,
           submitter_former_email = EXCLUDED.submitter_former_email, humble = EXCLUDED.humble,
           hungry = EXCLUDED.hungry, smart = EXCLUDED.smart, helpful_kind = EXCLUDED.helpful_kind,
           fast_response = EXCLUDED.fast_response, solves_problems = EXCLUDED.solves_problems,
           general_feedback = EXCLUDED.general_feedback, created_at = EXCLUDED.created_at`,
        [r._id, company.id, month, day, subjectId, subjectFormer,
         submitterId, submitterId ? null : text(r.submitter) || null, submitterId ? null : email || null,
         ...scores, text(r.feedback), created(r)],
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
  console.log(`  read ${n.read}, imported ${n.imported}`);
  console.log(`  former employees kept by name: ${n.formerSubjects} as subject, ${n.formerSubmitters} as submitter`);
  console.log(`  skipped: ${n.skippedScores} with blank/invalid scores, ${n.skippedDuplicate} duplicates (first kept), ${n.skippedSelf} self-assessments`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
