// Bonus Calculator (Bonus Admins only; one role does the whole process). Three steps for a month:
// 1) set the pool, 2) generate, review every person (confirm / exclude, team profitability) and
// save, 3) export for payroll. Numbers recalculate live while reviewing; the server recalculates
// again on save. Formula: src/lib/bonusMath.ts.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, Download, Info, X } from "lucide-react";
import { hubGet, hubPost, hubPut } from "../lib/hubApi";
import { CRITERIA, DEFAULT_PROFITABILITY, computeBonus, type BonusStatus } from "../lib/bonusMath";

type Pool = { amount: number; set_at: string; set_by: string | null } | null;
type SavedRow = { employee_id: string; employee_name: string; team: string; reliability: number; profitability: number; tenure: number; suggested: number; status: "confirmed" | "excluded"; payout: number };
type Saved = { pool: number; savedAt: string; savedBy: string | null; rows: SavedRow[] } | null;
type Overview = { month: string; current: string; history: string[]; pool: Pool; run: Saved };
type FreshRow = { employeeId: string; name: string; team: string; reliability: number; hasAssessments: boolean; breakdown: Record<string, number> | null;
  assessmentCount: number; tenure: number; hasHireDate: boolean; hiredOn: string | null };
type ReviewRow = { employeeId: string; name: string; team: string; reliability: number; tenure: number; profitability: number; status: BonusStatus;
  hasAssessments: boolean; hasHireDate: boolean; breakdown: Record<string, number> | null; assessmentCount: number; hiredOn: string | null };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (m: string, by: number) => { const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 7); };
const CRITERION_LABEL: Record<string, string> = { humble: "Humble", hungry: "Hungry", smart: "Smart", helpful_kind: "Helpful & kind", fast_response: "Fast response", solves_problems: "Solves problems" };
const PROFIT_LABEL: Record<number, string> = { 2: "Missed", 3: "Hit", 4: "Exceeded" };

function ProfitToggle({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden" role="group" aria-label={label}>
      {[2, 3, 4].map((v) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
          className={`px-2 py-1 text-xs font-semibold border-r border-slate-700 last:border-r-0 ${value === v ? "btn-brand rounded-none" : "bg-slate-900/70 text-slate-500"}`}>{PROFIT_LABEL[v]}</button>
      ))}
    </div>
  );
}

function Review({ month, pool, initial, basis, onSaved, onCancel }: {
  month: string; pool: number; initial: ReviewRow[]; basis: "fresh" | "saved"; onSaved: () => void; onCancel: () => void;
}) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const lines = useMemo(() => computeBonus(rows, pool), [rows, pool]);
  const teams = useMemo(() => [...new Set(rows.map((r) => r.team))].sort(), [rows]);
  const marked = rows.filter((r) => r.status !== "pending").length;
  const total = lines.reduce((s, l) => s + (l.status === "excluded" ? 0 : Math.round(l.suggested)), 0);
  const set = (id: string, patch: Partial<ReviewRow>) => setRows((rs) => rs.map((r) => (r.employeeId === id ? { ...r, ...patch } : r)));
  const setTeam = (team: string, profitability: number) => setRows((rs) => rs.map((r) => (r.team === team ? { ...r, profitability } : r)));
  const mark = (id: string, status: BonusStatus) => set(id, { status: rows.find((r) => r.employeeId === id)?.status === status ? "pending" : status });
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      await hubPost("/api/bonus/run", { month, basis, rows: rows.map((r) => ({ employeeId: r.employeeId, profitability: r.profitability, status: r.status })) });
      onSaved();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Profitability has no data source yet: it's set by hand per team (default Hit). Mark every person ✓ or ✗; excluding someone gives their share to everyone else.
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
        <span className="font-semibold">{marked} of {rows.length} reviewed · {money(total)} of {money(pool)}</span>
        <span className="flex gap-2">
          <button type="button" className="rounded-xl border border-slate-600 px-4 py-2" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-brand" disabled={busy || marked < rows.length} onClick={() => void save()}>{busy ? "Saving…" : "Save payouts"}</button>
        </span>
      </div>
      {msg && <div className="text-sm text-red-700">{msg}</div>}
      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500">
            <th className="p-3">Person</th><th className="p-3">Reliability</th><th className="p-3">Tenure</th><th className="p-3">Profitability</th>
            <th className="p-3 text-right">Suggested</th><th className="p-3 text-center">Review</th>
          </tr></thead>
          <tbody>
            {teams.map((team) => {
              const members = lines.filter((l) => rows.find((r) => r.employeeId === l.employeeId)!.team === team);
              const values = new Set(members.map((m) => m.profitability));
              return (
                <Fragment key={team}>
                  <tr className="border-t border-slate-700 bg-slate-900/60">
                    <td className="p-3 font-semibold uppercase text-xs text-slate-400" colSpan={3}>{team}</td>
                    <td className="p-3" colSpan={3}><ProfitToggle label={`${team} profitability`} value={values.size === 1 ? [...values][0] : null} onChange={(v) => setTeam(team, v)} /></td>
                  </tr>
                  {members.map((l) => {
                    const r = rows.find((x) => x.employeeId === l.employeeId)!;
                    return (
                      <Fragment key={l.employeeId}>
                        <tr className={`border-t border-slate-800 ${l.status === "excluded" ? "opacity-50" : ""}`}>
                          <td className="p-3"><div className="font-semibold">{r.name}</div></td>
                          <td className="p-3">
                            {r.reliability.toFixed(2)} {!r.hasAssessments && <span className="block text-xs font-semibold text-red-700">No peer assessments in 190 days</span>}
                            {r.breakdown && <button type="button" className="ml-1 align-middle text-slate-600 hover:text-slate-300" aria-label={`Reliability detail for ${r.name}`} onClick={() => setOpen(open === r.employeeId ? null : r.employeeId)}><Info className="w-4 h-4 inline" /></button>}
                          </td>
                          <td className="p-3">{r.tenure.toFixed(2)} yrs {!r.hasHireDate && <span className="block text-xs font-semibold text-red-700">No hire date</span>}</td>
                          <td className="p-3"><ProfitToggle label={`${r.name} profitability`} value={r.profitability} onChange={(v) => set(r.employeeId, { profitability: v })} /></td>
                          <td className="p-3 text-right font-semibold">{l.status === "excluded" ? "$0" : money(Math.round(l.suggested))}</td>
                          <td className="p-3 text-center whitespace-nowrap">
                            <button type="button" aria-pressed={l.status === "confirmed"} aria-label={`Confirm ${r.name}`} onClick={() => mark(r.employeeId, "confirmed")}
                              className={`rounded-lg border p-1.5 mr-1 ${l.status === "confirmed" ? "border-emerald-600 bg-emerald-600 text-[#fff]" : "border-slate-700 text-slate-600"}`}><Check className="w-4 h-4" /></button>
                            <button type="button" aria-pressed={l.status === "excluded"} aria-label={`Exclude ${r.name}`} onClick={() => mark(r.employeeId, "excluded")}
                              className={`rounded-lg border p-1.5 ${l.status === "excluded" ? "border-red-600 bg-red-600 text-[#fff]" : "border-slate-700 text-slate-600"}`}><X className="w-4 h-4" /></button>
                          </td>
                        </tr>
                        {open === r.employeeId && r.breakdown && (
                          <tr className="bg-slate-900/60"><td colSpan={6} className="p-3 text-xs text-slate-400">
                            Peer assessment averages from {r.assessmentCount} assessment{r.assessmentCount === 1 ? "" : "s"} in the last 190 days (1–4):{" "}
                            {CRITERIA.map((c) => <span key={c} className={`mr-3 ${r.breakdown![c] < 2.5 ? "font-semibold text-red-700" : ""}`}>{CRITERION_LABEL[c]} {r.breakdown![c].toFixed(2)}</span>)}
                            {r.hiredOn && <span className="block mt-1">Hired {r.hiredOn}</span>}
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function csv(rows: { firstName: string; lastName: string; team: string; status: string; payout: number }[]) {
  const f = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return ["Last Name,First Name,Team,Status,Payout", ...rows.map((r) => [r.lastName, r.firstName, r.team, r.status, r.payout].map(f).join(","))].join("\n");
}

export default function BonusPage() {
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [poolInput, setPoolInput] = useState("");
  const [review, setReview] = useState<{ rows: ReviewRow[]; basis: "fresh" | "saved" } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = (m = month) => hubGet<Overview>(`/api/bonus${m ? `?month=${m}` : ""}`)
    .then((d) => { setData(d); setMonth(d.month); setPoolInput(d.pool ? String(d.pool.amount) : ""); })
    .catch((e: Error) => setError(e.message));
  useEffect(() => { void load(""); }, []);

  if (error) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const months = [...new Set([shift(data.current, 1), data.current, shift(data.current, -1), ...data.history])].sort().reverse();
  const run = data.run;

  const pick = (m: string) => { setReview(null); setMsg(null); void load(m); };
  const savePool = async () => {
    setBusy("pool"); setMsg(null);
    try { await hubPut("/api/bonus/pool", { month, amount: Number(poolInput) }); setMsg({ ok: true, text: `Bonus pool for ${monthLabel(month)} saved.` }); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };
  const generate = async () => {
    setBusy("generate"); setMsg(null);
    try {
      const g = await hubGet<{ pool: number; rows: FreshRow[] }>(`/api/bonus/generate?month=${month}`);
      setReview({ basis: "fresh", rows: g.rows.map((r) => ({ ...r, profitability: DEFAULT_PROFITABILITY, status: "pending" as BonusStatus })) });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };
  const edit = () => run && setReview({ basis: "saved", rows: run.rows.map((r) => ({
    employeeId: r.employee_id, name: r.employee_name, team: r.team, reliability: r.reliability, tenure: r.tenure, profitability: r.profitability,
    status: r.status, hasAssessments: true, hasHireDate: true, breakdown: null, assessmentCount: 0, hiredOn: null })) });
  const exportCsv = async () => {
    setBusy("export"); setMsg(null);
    try {
      const x = await hubGet<{ month: string; rows: { firstName: string; lastName: string; team: string; status: string; payout: number }[] }>(`/api/bonus/export?month=${month}`);
      const url = URL.createObjectURL(new Blob([csv(x.rows)], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `bonus-payouts-${x.month}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };
  const paid = run ? run.rows.filter((r) => r.status === "confirmed") : [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Bonus Calculator</h1>
          <p className="text-sm text-slate-500">Reliability 50% · Profitability 35% · Tenure 15% of the month's pool, split by each person's share.</p>
        </div>
        <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={month} onChange={(e) => pick(e.target.value)} disabled={!!review}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>
      {msg && <div className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</div>}

      <section className="glass-card rounded-2xl p-5 space-y-3">
        <div className="font-semibold">1 · Bonus pool</div>
        {data.pool && <div className="text-sm text-slate-400">{money(data.pool.amount)} set{data.pool.set_by ? ` by ${data.pool.set_by}` : ""} on {new Date(data.pool.set_at).toLocaleDateString()}</div>}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm">$</span>
          <input type="number" min="0" step="0.01" value={poolInput} onChange={(e) => setPoolInput(e.target.value)} disabled={!!review}
            className="w-40 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" aria-label="Bonus pool amount" />
          <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" disabled={!!busy || !!review || !(Number(poolInput) > 0)} onClick={() => void savePool()}>
            {data.pool ? "Update pool" : "Set pool"}</button>
        </div>
        {run && data.pool && run.pool !== data.pool.amount && (
          <div className="text-sm text-amber-800">The saved run used {money(run.pool)}. Generate again to use the new pool.</div>
        )}
      </section>

      <section className="glass-card rounded-2xl p-5 space-y-3">
        <div className="font-semibold">2 · Payouts</div>
        {review ? (
          <Review month={month} pool={review.basis === "saved" && run ? run.pool : data.pool?.amount ?? 0} initial={review.rows} basis={review.basis}
            onCancel={() => setReview(null)} onSaved={() => { setReview(null); setMsg({ ok: true, text: `Payouts for ${monthLabel(month)} saved.` }); void load(); }} />
        ) : run ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><div className="text-xs text-slate-500">Pool</div><div className="text-lg font-bold">{money(run.pool)}</div></div>
              <div><div className="text-xs text-slate-500">Paid out</div><div className="text-lg font-bold">{money(paid.reduce((s, r) => s + r.payout, 0))}</div></div>
              <div><div className="text-xs text-slate-500">People</div><div className="text-lg font-bold">{paid.length} paid · {run.rows.length - paid.length} excluded</div></div>
              <div><div className="text-xs text-slate-500">Saved</div><div className="font-semibold">{new Date(run.savedAt).toLocaleDateString()}{run.savedBy ? ` by ${run.savedBy}` : ""}</div></div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="rounded-xl border border-slate-600 px-4 py-2" onClick={edit}>Edit this run</button>
              <button type="button" className="btn-text" disabled={!!busy || !data.pool} onClick={() => void generate()}>Start over with fresh numbers</button>
            </div>
            <details><summary className="cursor-pointer text-slate-400">See every payout</summary>
              <table className="w-full text-sm mt-2"><tbody>
                {run.rows.map((r) => (
                  <tr key={r.employee_id} className="border-t border-slate-800"><td className="p-2">{r.employee_name}</td><td className="p-2 text-slate-500">{r.team}</td>
                    <td className="p-2">{r.status === "confirmed" ? "Confirmed" : "Excluded"}</td><td className="p-2 text-right font-semibold">{money(r.payout)}</td></tr>
                ))}
              </tbody></table>
            </details>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="text-slate-400">{data.pool ? "Nothing saved for this month yet." : "Set the pool first."}</div>
            <button type="button" className="btn-brand" disabled={!!busy || !data.pool} onClick={() => void generate()}>{busy === "generate" ? "Generating…" : "Generate suggested payouts"}</button>
          </div>
        )}
      </section>

      <section className="glass-card rounded-2xl p-5 space-y-2">
        <div className="font-semibold">3 · Export for payroll</div>
        <div className="text-sm text-slate-400">Every active employee with their status and payout, as a spreadsheet.</div>
        <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm inline-flex items-center gap-2" disabled={!run || !!review || !!busy} onClick={() => void exportCsv()}>
          <Download className="w-4 h-4" /> Download CSV</button>
      </section>
    </div>
  );
}
