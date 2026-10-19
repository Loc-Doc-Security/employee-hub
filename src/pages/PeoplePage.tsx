import { useEffect, useMemo, useState } from "react";
import { hubGet } from "../lib/hubApi";

type Org = {
  companies: { id: string; name: string }[];
  departments: { id: string; company_id: string; name: string }[];
  branches: { id: string; company_id: string; name: string }[];
};

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string | null;
  employee_type: "office" | "tech" | null;
  vehicle_number: string | null;
  is_active: boolean;
  company: string;
  branch: string | null;
  departments: string[];
  roles: string[];
};

export default function PeoplePage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [people, setPeople] = useState<Employee[]>([]);
  const [filters, setFilters] = useState({ company: "", department: "", branch: "", status: "active" });
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    hubGet<Org>("/api/org").then(setOrg).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    hubGet<Employee[]>(`/api/employees?${params}`)
      .then((rows) => {
        setPeople(rows);
        setError("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  const inCompany = <T extends { company_id: string }>(list: T[] = []) =>
    filters.company ? list.filter((x) => x.company_id === filters.company) : list;

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return people;
    return people.filter((p) =>
      `${p.first_name} ${p.last_name} ${p.email} ${p.vehicle_number ?? ""}`.toLowerCase().includes(s),
    );
  }, [people, search]);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value, ...(k === "company" ? { department: "", branch: "" } : {}) }));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">People</h1>
          <p className="text-sm text-slate-400">{loading ? "Loading…" : `${shown.length} shown`}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm"
            placeholder="Search name, email, van #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={filters.company} onChange={set("company")}>
            <option value="">All companies</option>
            {org?.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={filters.department} onChange={set("department")}>
            <option value="">All departments</option>
            {inCompany(org?.departments).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={filters.branch} onChange={set("branch")}>
            <option value="">All branches</option>
            {inCompany(org?.branches).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={filters.status} onChange={set("status")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {error && <div className="glass-card rounded-2xl p-4 text-sm text-red-700">{error}</div>}

      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Department</th>
              <th className="p-3">Branch</th>
              <th className="p-3">Type</th>
              <th className="p-3">Van #</th>
              <th className="p-3">Roles</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="p-3">
                  <div className="font-semibold">
                    {p.first_name} {p.last_name}
                    {!p.is_active && <span className="ml-2 text-xs text-slate-600">inactive</span>}
                  </div>
                  <div className="text-xs text-slate-500">{p.email}</div>
                </td>
                <td className="p-3">{p.departments.join(", ") || "—"}</td>
                <td className="p-3">{p.branch ?? "—"}</td>
                <td className="p-3 capitalize">{p.employee_type ?? "—"}</td>
                <td className="p-3">{p.vehicle_number ?? "—"}</td>
                <td className="p-3 text-xs">{p.roles.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
