/**
 * Imports Wix Employees into the core tables as company #1 (Loc-Doc).
 *
 * Reads Employees.json from a Wix export folder (made by locdoc-hub-app's `npm run export:wix`).
 * Keeps each Wix _id as the employee id. Safe to re-run: profiles, departments and branches are
 * upserted, and role assignments with source 'wix_import' are replaced each time ('manual'
 * assignments are never touched). Runs in one transaction, so a failure changes nothing.
 *
 * Usage: npx tsx scripts/migration/import-employees.ts [path/to/wix-export/<timestamp>]
 *   (defaults to the newest export under ../locdoc-hub-app/wix-export)
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";

config({ path: [".env.local", ".env"], quiet: true });

const COMPANY = { slug: "loc-doc", name: "Loc-Doc", emailDomains: ["locdoc.net"] };
// Levi runs every company (decided 2026-10-15). Not something Wix records, so granted here.
const SUPER_ADMINS = ["levi@locdoc.net"];
const CSUITE_DEPARTMENT = "CSuite"; // a role in disguise, not a real department
const TOOL_ROLES: Record<string, string> = {
  lifecycleAdmin: "lifecycle_admin",
  bonusAdmin: "bonus_admin",
  driverScorecard: "scorecard_uploader",
  cleanlinessAdmin: "cleanliness_admin",
  shopAdmin: "shop_admin",
};

type WixEmployee = Record<string, unknown> & { _id: string };

const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const orNull = (v: unknown) => text(v) || null;
const dateOnly = (v: unknown) => {
  const raw = v && typeof v === "object" && "$date" in v ? (v as { $date: string }).$date : text(v);
  return raw ? raw.slice(0, 10) : null;
};
const parseList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try {
    const p = JSON.parse(text(v) || "[]");
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
};

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const rows: WixEmployee[] = JSON.parse(await readFile(path.join(exportDir, "collections", "Employees.json"), "utf8"));
  const url = process.env.PRODUCT_DATABASE_URL?.trim();
  if (!url) throw new Error("Set PRODUCT_DATABASE_URL (see .env.example).");

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const report = {
    employees: 0, active: 0, departments: new Set<string>(), branches: new Set<string>(),
    roleAssignments: 0, wixImagePhotos: 0, notes: [] as string[],
  };

  try {
    await db.query("BEGIN");
    await db.query("SET search_path TO employee_hub");

    const companyId: string = (await db.query(
      `INSERT INTO companies (slug, name, email_domains) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now() RETURNING id`,
      [COMPANY.slug, COMPANY.name, COMPANY.emailDomains],
    )).rows[0].id;

    const roleIds: Record<string, string> = {};
    for (const r of (await db.query("SELECT id, key FROM roles")).rows) roleIds[r.key] = r.id;

    const deptIds = new Map<string, string>();
    const ensureDept = async (name: string) => {
      if (!deptIds.has(name)) {
        const id = (await db.query(
          `INSERT INTO departments (company_id, name) VALUES ($1, $2)
           ON CONFLICT (company_id, name) DO UPDATE SET updated_at = now() RETURNING id`,
          [companyId, name],
        )).rows[0].id;
        deptIds.set(name, id);
        report.departments.add(name);
      }
      return deptIds.get(name)!;
    };
    const branchIds = new Map<string, string>();
    const ensureBranch = async (name: string) => {
      if (!branchIds.has(name)) {
        const id = (await db.query(
          `INSERT INTO branches (company_id, name) VALUES ($1, $2)
           ON CONFLICT (company_id, name) DO UPDATE SET updated_at = now() RETURNING id`,
          [companyId, name],
        )).rows[0].id;
        branchIds.set(name, id);
        report.branches.add(name);
      }
      return branchIds.get(name)!;
    };

    await db.query("DELETE FROM role_assignments WHERE source = 'wix_import' AND company_id = $1", [companyId]);
    const assign = async (employeeId: string, roleKey: string, scope: "global" | "company" | "department", departmentId?: string) => {
      const res = await db.query(
        `INSERT INTO role_assignments (employee_id, role_id, scope_type, company_id, department_id, source)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [employeeId, roleIds[roleKey], scope, scope === "global" ? null : companyId, departmentId ?? null,
         scope === "global" ? "manual" : "wix_import"],
      );
      report.roleAssignments += res.rowCount ?? 0;
    };

    for (const e of rows) {
      const name = `${text(e.firstName)} ${text(e.lastName)}`.trim();
      const department = text(e.department);
      const branch = text(e.branch);
      const photo = orNull(e.headshot);
      if (photo?.startsWith("wix:")) report.wixImagePhotos++;
      const type = text(e.type).toLowerCase();

      await db.query(
        `INSERT INTO employees (id, company_id, email, first_name, last_name, title, phone, photo_url, hired_on,
           employee_type, branch_id, vehicle_number, vehicle_noun, has_office, is_bonus_eligible, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, email = EXCLUDED.email,
           first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, title = EXCLUDED.title,
           phone = EXCLUDED.phone, photo_url = EXCLUDED.photo_url, hired_on = EXCLUDED.hired_on,
           employee_type = EXCLUDED.employee_type, branch_id = EXCLUDED.branch_id,
           vehicle_number = EXCLUDED.vehicle_number, vehicle_noun = EXCLUDED.vehicle_noun,
           has_office = EXCLUDED.has_office, is_bonus_eligible = EXCLUDED.is_bonus_eligible,
           is_active = EXCLUDED.is_active, updated_at = now()`,
        [
          e._id, companyId, text(e.email).toLowerCase(), text(e.firstName), text(e.lastName), orNull(e.title),
          orNull(e.phoneNumber), photo, dateOnly(e.startDate),
          type === "office" || type === "tech" ? type : null,
          branch ? await ensureBranch(branch) : null,
          orNull(e.vehicleNumber), orNull(e.vehicleNoun), e.hasOffice === true, e.bonusOptOut !== true,
          e.active === true,
        ],
      );
      report.employees++;
      if (e.active === true) report.active++;
      if (type && type !== "office" && type !== "tech") report.notes.push(`${name}: unknown type "${type}" left blank`);

      // Membership: the one department, except CSuite, which becomes a role.
      await db.query("DELETE FROM employee_departments WHERE employee_id = $1", [e._id]);
      if (department && department !== CSUITE_DEPARTMENT) {
        await db.query("INSERT INTO employee_departments (employee_id, department_id) VALUES ($1, $2)",
          [e._id, await ensureDept(department)]);
      }
      if (department === CSUITE_DEPARTMENT) await assign(e._id, "csuite", "company");

      // Management: "Operations" = every department; otherwise a comma list of department names.
      // Super admins skip this: Levi's Wix "Operations" value was only for testing (2026-10-15), and
      // a Manager role would list him as a manager in team reports.
      const isSuperAdmin = SUPER_ADMINS.includes(text(e.email).toLowerCase());
      const manager = isSuperAdmin ? "" : text(e.manager);
      if (manager === "Operations") {
        await assign(e._id, "manager", "company");
      } else if (manager) {
        for (const d of manager.split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!rows.some((r) => text(r.department) === d)) report.notes.push(`${name}: manages "${d}", which no employee belongs to (department created)`);
          await assign(e._id, "manager", "department", await ensureDept(d));
        }
      }

      // Tools: toolAccess keys plus the legacy shopAdmin checkbox.
      const tools = new Set(parseList(e.toolAccess));
      if (e.shopAdmin === true) tools.add("shopAdmin");
      for (const t of tools) {
        if (TOOL_ROLES[t]) await assign(e._id, TOOL_ROLES[t], "company");
        else report.notes.push(`${name}: unknown toolAccess key "${t}" skipped`);
      }

      if (isSuperAdmin) await assign(e._id, "super_admin", "global");
    }

    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }

  console.log(`Imported from ${exportDir}`);
  console.log(`  employees: ${report.employees} (${report.active} active)`);
  console.log(`  departments: ${report.departments.size}  branches: ${report.branches.size}`);
  console.log(`  role assignments created: ${report.roleAssignments}`);
  console.log(`  photos still on Wix (re-host in phase 2): ${report.wixImagePhotos}`);
  if (report.notes.length) console.log("  notes:\n" + report.notes.map((n) => `    - ${n}`).join("\n"));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
