// Admin console: Onboarding Admins only (the one gate for people, roles, departments, branches).
// Companies tab: super admin only. Every change is in the Activity tab.
import { useEffect, useMemo, useState } from "react";
import { hubDelete, hubGet, hubPatch, hubPost } from "../lib/hubApi";

type Role = { id: string; role: string; roleName: string; scope: "company" | "department" | "global"; departmentId: string | null; department: string | null; source: string };
type Person = {
  id: string; email: string; first_name: string; last_name: string; title: string | null; phone: string | null;
  employee_type: "office" | "tech" | null; branch_id: string | null; vehicle_number: string | null; vehicle_noun: string | null;
  has_office: boolean; is_bonus_eligible: boolean; is_active: boolean; hired_on: string | null; omst_linked: boolean;
  department_ids: string[]; roles: Role[];
};
type Named = { id: string; name: string; is_active: boolean };
type Options = {
  departments: Named[]; branches: Named[]; roles: { key: string; name: string; description: string }[];
  companies: { id: string; name: string; slug: string; email_domains: string[] }[]; canAddCompany: boolean;
};

const field = "w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm";

function PersonEditor({ person, opts, onDone, onCancel }: { person: Person | null; opts: Options; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    firstName: person?.first_name ?? "", lastName: person?.last_name ?? "", email: person?.email ?? "",
    title: person?.title ?? "", phone: person?.phone ?? "", employeeType: person?.employee_type ?? "",
    branchId: person?.branch_id ?? "", vehicleNumber: person?.vehicle_number ?? "", vehicleNoun: person?.vehicle_noun ?? "",
    hasOffice: person?.has_office ?? false, isBonusEligible: person?.is_bonus_eligible ?? true, hiredOn: person?.hired_on ?? "",
  });
  const [depts, setDepts] = useState<string[]>(person?.department_ids ?? []);
  const [roleKey, setRoleKey] = useState("");
  const [roleDept, setRoleDept] = useState("");
  const [roles, setRoles] = useState<Role[]>(person?.roles ?? []);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const save = async () => {
    setError("");
    try {
      if (person) await hubPatch(`/api/admin/people/${person.id}`, { ...f, departmentIds: depts });
      else await hubPost("/api/admin/people", { ...f, departmentIds: depts });
      onDone();
    } catch (e) { setError((e as Error).message); }
  };
  const setActive = async (isActive: boolean) => {
    if (!person) return;
    if (!isActive && !confirm(`Deactivate ${person.first_name} ${person.last_name}? They lose Employee Hub access right away; their history is kept. Remember to remove their app access in OMST too.`)) return;
    try { await hubPatch(`/api/admin/people/${person.id}`, { isActive }); onDone(); } catch (e) { setError((e as Error).message); }
  };
  const grant = async () => {
    if (!person) return;
    setError("");
    try {
      await hubPost(`/api/admin/people/${person.id}/roles`, { roleKey, departmentId: roleDept || null });
      const fresh = await hubGet<Person[]>("/api/admin/people?status=all");
      setRoles(fresh.find((p) => p.id === person.id)?.roles ?? []);
      setRoleKey(""); setRoleDept(""); setMsg("Role granted.");
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (r: Role) => {
    if (!confirm(`Remove ${r.roleName}${r.department ? ` (${r.department})` : ""}?`)) return;
    try { await hubDelete(`/api/admin/roles/${r.id}`, {}); setRoles(roles.filter((x) => x.id !== r.id)); setMsg("Role removed."); }
    catch (e) { setError((e as Error).message); }
  };

  const activeDepts = opts.departments.filter((d) => d.is_active || depts.includes(d.id));
  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">{person ? `${person.first_name} ${person.last_name}` : "Add an employee"}</h2>
        {person && <span className="text-xs text-slate-500">{person.omst_linked ? "✓ Linked to OMST" : "Not linked to OMST yet (links on their first sign-in)"}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <label>First name<input className={field} value={f.firstName} onChange={set("firstName")} /></label>
        <label>Last name<input className={field} value={f.lastName} onChange={set("lastName")} /></label>
        <label>Email{person?.omst_linked && <span className="text-slate-500"> (managed in OMST)</span>}
          <input className={field} value={f.email} onChange={set("email")} disabled={!!person?.omst_linked} /></label>
        <label>Title<input className={field} value={f.title} onChange={set("title")} /></label>
        <label>Phone<input className={field} value={f.phone} onChange={set("phone")} /></label>
        <label>Hire date<input type="date" className={field} value={f.hiredOn} onChange={set("hiredOn")} /></label>
        <label>Type<select className={field} value={f.employeeType} onChange={set("employeeType")}><option value="">—</option><option value="office">Office</option><option value="tech">Tech</option></select></label>
        <label>Branch<select className={field} value={f.branchId} onChange={set("branchId")}><option value="">—</option>
          {opts.branches.filter((b) => b.is_active || b.id === f.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Van / vehicle #<input className={field} value={f.vehicleNumber} onChange={set("vehicleNumber")} /></label>
        <label>Vehicle word<input className={field} placeholder="Van" value={f.vehicleNoun} onChange={set("vehicleNoun")} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.hasOffice} onChange={set("hasOffice")} /> Has an office (cleanliness audit)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isBonusEligible} onChange={set("isBonusEligible")} /> Bonus eligible</label>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-semibold">Departments</div>
        <div className="flex flex-wrap gap-2">
          {activeDepts.map((d) => (
            <label key={d.id} className={`rounded-xl border px-3 py-1 text-sm cursor-pointer ${depts.includes(d.id) ? "btn-brand" : "border-slate-700"}`}>
              <input type="checkbox" className="hidden" checked={depts.includes(d.id)}
                onChange={(e) => setDepts(e.target.checked ? [...depts, d.id] : depts.filter((x) => x !== d.id))} />{d.name}
            </label>
          ))}
        </div>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn-brand" onClick={() => void save()}>{person ? "Save changes" : "Add employee"}</button>
        <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={onCancel}>Cancel</button>
        {person && (person.is_active
          ? <button type="button" className="ml-auto rounded-xl border border-red-300 px-4 py-2 text-sm text-red-700" onClick={() => void setActive(false)}>Deactivate</button>
          : <button type="button" className="ml-auto rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={() => void setActive(true)}>Reactivate</button>)}
      </div>

      {person && (
        <div className="space-y-3 border-t border-slate-700 pt-4">
          <div className="flex items-center justify-between"><div className="font-semibold">Roles</div><div className="text-xs text-slate-500">{msg}</div></div>
          {roles.length === 0 && <div className="text-sm text-slate-500">No roles. Every active employee is an Employee automatically.</div>}
          {roles.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{r.roleName} <span className="text-slate-500">· {r.scope === "department" ? r.department : r.scope === "global" ? "every company" : "whole company"}</span></span>
              {r.role !== "super_admin" && <button type="button" className="btn-text" onClick={() => void remove(r)}>Remove</button>}
            </div>
          ))}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
            <select className={field} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
              <option value="">Grant a role…</option>
              {opts.roles.map((r) => <option key={r.key} value={r.key} title={r.description}>{r.name}</option>)}
            </select>
            <select className={field} value={roleDept} onChange={(e) => setRoleDept(e.target.value)}>
              <option value="">Whole company</option>
              {opts.departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>Only {d.name}</option>)}
            </select>
            <button type="button" className="btn-brand" disabled={!roleKey} onClick={() => void grant()}>Grant</button>
          </div>
        </div>
      )}
    </div>
  );
}

function People({ opts }: { opts: Options }) {
  const [status, setStatus] = useState("active");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const load = () => hubGet<Person[]>(`/api/admin/people?status=${status}`).then(setPeople).catch(() => setPeople([]));
  useEffect(() => { void load(); }, [status]);
  const deptName = useMemo(() => new Map(opts.departments.map((d) => [d.id, d.name])), [opts]);

  if (editing) {
    return <PersonEditor key={editing === "new" ? "new" : editing.id} person={editing === "new" ? null : editing} opts={opts}
      onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />;
  }
  const s = search.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !s || `${p.first_name} ${p.last_name} ${p.email} ${p.vehicle_number ?? ""}`.toLowerCase().includes(s));
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <input className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" placeholder="Search name, email, van #" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
        </select>
        <button type="button" className="btn-brand ml-auto" onClick={() => setEditing("new")}>+ Add employee</button>
      </div>
      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-t border-slate-800 first:border-t-0 cursor-pointer hover:bg-slate-900/60" onClick={() => setEditing(p)}>
                <td className="p-3"><div className="font-semibold">{p.first_name} {p.last_name}{!p.is_active && <span className="ml-2 text-xs text-slate-600">inactive</span>}</div><div className="text-xs text-slate-500">{p.email}</div></td>
                <td className="p-3 text-slate-400">{p.department_ids.map((d) => deptName.get(d)).filter(Boolean).join(", ") || "—"}</td>
                <td className="p-3 text-xs text-slate-500">{p.roles.map((r) => r.roleName).join(", ")}</td>
                <td className="p-3 text-xs">{p.omst_linked ? "✓ OMST" : <span className="text-slate-600">not linked</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrgList({ kind, items, onChanged }: { kind: "departments" | "branches"; items: Named[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const act = async (fn: () => Promise<unknown>) => { setError(""); try { await fn(); onChanged(); } catch (e) { setError((e as Error).message); } };
  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="font-semibold capitalize">{kind}</div>
      {items.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-sm">
          <input className={`${field} ${d.is_active ? "" : "text-slate-600"}`} defaultValue={d.name}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.name && void act(() => hubPatch(`/api/admin/${kind}/${d.id}`, { name: e.target.value }))} />
          <button type="button" className="btn-text whitespace-nowrap" onClick={() => void act(() => hubPatch(`/api/admin/${kind}/${d.id}`, { isActive: !d.is_active }))}>
            {d.is_active ? "Retire" : "Restore"}
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input className={field} placeholder={`New ${kind === "departments" ? "department" : "branch"}`} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn-brand" disabled={!name.trim()} onClick={() => void act(async () => { await hubPost(`/api/admin/${kind}`, { name }); setName(""); })}>Add</button>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
    </div>
  );
}

function Activity() {
  const [rows, setRows] = useState<{ id: string; summary: string; actor: string; created_at: string }[] | null>(null);
  useEffect(() => { hubGet<typeof rows>("/api/admin/activity").then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {rows.length === 0 && <div className="p-4 text-sm text-slate-500">No admin changes yet.</div>}
      {rows.map((r) => (
        <div key={r.id} className="flex justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm first:border-t-0">
          <span><span className="font-semibold">{r.actor}</span> · {r.summary}</span>
          <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function Companies({ opts, onChanged }: { opts: Options; onChanged: () => void }) {
  const [f, setF] = useState({ name: "", slug: "", domains: "" });
  const [error, setError] = useState("");
  const add = async () => {
    setError("");
    try {
      await hubPost("/api/admin/companies", { name: f.name, slug: f.slug, emailDomains: f.domains.split(",").map((d) => d.trim()).filter(Boolean) });
      setF({ name: "", slug: "", domains: "" });
      onChanged();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="space-y-3">
      <div className="glass-card rounded-2xl overflow-hidden">
        {opts.companies.map((c) => (
          <div key={c.id} className="flex justify-between border-t border-slate-800 px-4 py-3 text-sm first:border-t-0">
            <span className="font-semibold">{c.name}</span><span className="text-slate-500">{c.slug} · {c.email_domains.join(", ") || "no domains"}</span>
          </div>
        ))}
      </div>
      <div className="glass-card rounded-2xl p-5 space-y-2">
        <div className="font-semibold">Add a company</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className={field} placeholder="Name (Buffalo Security)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className={field} placeholder="Short id (buffalo-security)" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
          <input className={field} placeholder="Email domains, comma separated" value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} />
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <button type="button" className="btn-brand" disabled={!f.name || !f.slug} onClick={() => void add()}>Add company</button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [opts, setOpts] = useState<Options | null>(null);
  const [tab, setTab] = useState<"people" | "org" | "activity" | "companies">("people");
  const [error, setError] = useState("");
  const load = () => hubGet<Options>("/api/admin/options").then(setOpts).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  if (error) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (!opts) return <div className="text-sm text-slate-500">Loading…</div>;
  const tabs: [typeof tab, string][] = [["people", "People"], ["org", "Departments & branches"], ["activity", "Activity"], ...(opts.canAddCompany ? [["companies", "Companies"] as [typeof tab, string]] : [])];
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Admin</h1>
      <div className="flex gap-2 flex-wrap" role="tablist">
        {tabs.map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{n}</button>
        ))}
      </div>
      {tab === "people" && <People opts={opts} />}
      {tab === "org" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OrgList kind="departments" items={opts.departments} onChanged={() => void load()} />
          <OrgList kind="branches" items={opts.branches} onChanged={() => void load()} />
        </div>
      )}
      {tab === "activity" && <Activity />}
      {tab === "companies" && opts.canAddCompany && <Companies opts={opts} onChanged={() => void load()} />}
    </div>
  );
}
