// Resources: policies, processes and tutorials. Google Docs come from the company's Drive folder
// (subfolders = categories); PDFs and videos are uploaded here; a resource can also be a link.
// Everyone reads; Resources admins get a Manage tab (Drive folder, Sync now, uploads, addresses).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, FileText, Film, Link2, RefreshCw, Search, Sparkles } from "lucide-react";
import { hubGet, hubPatch, hubPost, hubPut, hubUpload } from "../lib/hubApi";
import PageTitle from "../components/PageTitle";

export type Resource = {
  id: string; slug: string; kind: "doc" | "file" | "link"; title: string; description: string | null; category: string;
  scope: "company" | "oms"; updatedAt: string; createdAt: string; isActive: boolean; driveUrl: string | null; url: string | null;
  contentType: string | null; snippet?: string | null;
};

const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ResourceIcon({ r, className = "w-5 h-5" }: { r: Pick<Resource, "kind" | "contentType">; className?: string }) {
  if (r.kind === "link") return <Link2 className={className} />;
  if (r.kind === "file" && r.contentType?.startsWith("video/")) return <Film className={className} />;
  return <FileText className={className} />;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const COLLAPSED_KEY = "resources.collapsed";

/** Which categories this person has collapsed; remembered in this browser only. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const save = (next: Set<string>) => {
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* private window: just don't remember */ }
  };
  const toggle = (c: string) => { const next = new Set(collapsed); if (next.has(c)) next.delete(c); else next.add(c); save(next); };
  return { collapsed, toggle, setAll: (cats: string[]) => save(new Set(cats)) };
}

function Card({ r, badge }: { r: Resource; badge?: string }) {
  return (
    <Link to={`/resources/${r.slug}`} className="glass-card rounded-2xl p-4 flex gap-3 hover:shadow-md transition-shadow">
      <span className="hub-icon-chip hub-icon-chip--sm"><ResourceIcon r={r} /></span>
      <span className="min-w-0 space-y-1">
        <span className="block font-semibold">
          {badge && <span className="mr-2 rounded-full px-2 py-0.5 text-xs font-semibold align-middle" style={{ background: "var(--theme-accent-100, #dbeafe)", color: "var(--theme-accent-800, #1e40af)" }}>{badge}</span>}
          {r.title}
        </span>
        {(r.snippet || r.description) && <span className="block text-sm text-slate-400 line-clamp-2">{r.snippet ?? r.description}</span>}
        <span className="block text-xs text-slate-500">{badge ? `${r.category} · ` : ""}Updated {fmt(r.updatedAt)}{r.scope === "oms" ? " · OMS-wide" : ""}</span>
      </span>
    </Link>
  );
}

function Browse({ onManage }: { onManage: (() => void) | null }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [data, setData] = useState<{ items: Resource[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      hubGet<{ items: Resource[] }>(`/api/resources${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`).then(setData).catch((e: Error) => setError(e.message));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);

  const categories = useMemo(() => ["All", ...new Set((data?.items ?? []).map((r) => r.category))], [data]);
  const shown = (data?.items ?? []).filter((r) => category === "All" || r.category === category);
  const groups = useMemo(() => {
    const m = new Map<string, Resource[]>();
    for (const r of shown) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m];
  }, [shown]);

  const { collapsed, toggle, setAll } = useCollapsed();
  const browsing = !q.trim() && category === "All";
  const now = Date.now();
  const recent = browsing ? (data?.items ?? [])
    .filter((r) => now - new Date(r.updatedAt).getTime() < WEEK)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  // While searching, show every match; collapsing is for browsing.
  const isOpen = (cat: string) => !browsing || !collapsed.has(cat);
  const allCollapsed = groups.length > 0 && groups.every(([c]) => collapsed.has(c));

  if (error) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="relative flex-1 min-w-[16rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and the text inside documents…"
            className="w-full rounded-xl border border-slate-700 bg-slate-900/70 pl-9 pr-3 py-2 text-sm" aria-label="Search resources" />
        </label>
        {browsing && groups.length > 1 && (
          <button type="button" className="btn-text" onClick={() => setAll(allCollapsed ? [] : groups.map(([c]) => c))}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
        {onManage && <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={onManage}>Manage</button>}
      </div>
      {categories.length > 2 && (
        <div className="flex gap-2 flex-wrap">
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1 text-sm ${category === c ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{c}</button>
          ))}
        </div>
      )}
      {!data ? <div className="text-sm text-slate-500">Loading…</div>
        : !shown.length ? <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">{q ? `Nothing matches "${q}".` : "No resources yet."}</div>
        : <>
          {recent.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold inline-flex items-center gap-2"><Sparkles className="w-4 h-4" /> Recently updated <span className="text-sm font-normal text-slate-500">last 7 days</span></h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {recent.map((r) => <Card key={r.id} r={r} badge={now - new Date(r.createdAt).getTime() < WEEK ? "New" : "Updated"} />)}
              </div>
            </section>
          )}
          {groups.map(([cat, items]) => (
            <section key={cat} className="space-y-2">
              <button type="button" onClick={() => browsing && toggle(cat)} aria-expanded={isOpen(cat)}
                className="flex items-center gap-2 text-lg font-semibold" disabled={!browsing}>
                {browsing && (isOpen(cat) ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />)}
                {cat} <span className="text-sm font-normal text-slate-500">{items.length}</span>
              </button>
              {isOpen(cat) && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {items.map((r) => <Card key={r.id} r={r} />)}
                </div>
              )}
            </section>
          ))}
        </>}
    </div>
  );
}

type ScopeAdmin = {
  scope: "company" | "oms";
  source: { folderId: string; folderUrl: string; lastSyncedAt: string | null; lastResult: null | { error?: string; added?: number; updated?: number; unchanged?: number; archived?: number; skipped?: { name: string; reason: string }[] } } | null;
  items: Resource[];
};
type AdminData = { driveConnected: boolean; serviceAccountEmail: string | null; scopes: ScopeAdmin[] };

function DriveFolder({ s, admin, reload }: { s: ScopeAdmin; admin: AdminData; reload: () => void }) {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const r = s.source?.lastResult;
  const save = async () => {
    setBusy("save"); setMsg("");
    try { await hubPut("/api/resources/admin/source", { scope: s.scope, folder }); setFolder(""); reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(""); }
  };
  const sync = async () => {
    setBusy("sync"); setMsg("");
    try { await hubPost("/api/resources/admin/sync", { scope: s.scope }); reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold">Google Drive folder</div>
          <div className="text-sm text-slate-500">Google Docs in this folder appear here automatically; subfolders become categories. Checked every 10 minutes.</div>
        </div>
        {s.source && admin.driveConnected && (
          <button type="button" className="btn-brand inline-flex items-center gap-2" disabled={!!busy} onClick={() => void sync()}>
            <RefreshCw className={`w-4 h-4 ${busy === "sync" ? "animate-spin" : ""}`} /> {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>
      {!admin.driveConnected && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Google Drive isn't connected on this server yet (no service account key), so Docs can't sync. Docs imported from Wix still show.
        </div>
      )}
      {admin.serviceAccountEmail && (
        <div className="text-sm text-slate-400">Share the folder with <code className="font-mono">{admin.serviceAccountEmail}</code> as <b>Viewer</b>.</div>
      )}
      {s.source ? (
        <div className="text-sm space-y-1">
          <div><a className="underline" href={s.source.folderUrl} target="_blank" rel="noreferrer">Open the folder in Drive</a>
            {s.source.lastSyncedAt && <span className="text-slate-500"> · last synced {new Date(s.source.lastSyncedAt).toLocaleString()}</span>}</div>
          {r?.error && <div className="text-red-700">Last sync failed: {r.error}</div>}
          {r && !r.error && <div className="text-slate-400">{r.added} added, {r.updated} updated, {r.unchanged} unchanged, {r.archived} removed</div>}
          {!!r?.skipped?.length && (
            <details><summary className="cursor-pointer text-amber-800">{r.skipped.length} file(s) skipped</summary>
              <ul className="mt-1 list-disc pl-5 text-slate-400">{r.skipped.map((k) => <li key={k.name + k.reason}><b>{k.name}</b>: {k.reason}</li>)}</ul>
            </details>
          )}
        </div>
      ) : <div className="text-sm text-slate-500">No folder connected yet.</div>}
      <div className="flex gap-2 flex-wrap">
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Paste the folder's Drive link"
          className="flex-1 min-w-[16rem] rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" />
        <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" disabled={!folder.trim() || !!busy} onClick={() => void save()}>
          {s.source ? "Change folder" : "Connect folder"}
        </button>
      </div>
      {msg && <div className="text-sm text-red-700">{msg}</div>}
    </div>
  );
}

function AddResource({ scope, categories, reload }: { scope: "company" | "oms"; categories: string[]; reload: () => void }) {
  const [kind, setKind] = useState<"file" | "link">("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const add = async () => {
    setMsg("");
    try {
      let uploadId: string | undefined;
      if (kind === "file") {
        if (!file) return setMsg("Choose a PDF or video.");
        if (file.size > 300 * 1024 * 1024) return setMsg("Files can be at most 300 MB.");
        setBusy("Uploading…");
        uploadId = await hubUpload(file, "resource", 1);
      }
      setBusy("Saving…");
      await hubPost("/api/resources", { scope, kind, title, description, category, uploadId, url });
      setTitle(""); setDescription(""); setUrl(""); setFile(null);
      reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="font-semibold">Add a PDF, video or link</div>
      <div className="flex gap-2">
        {(["file", "link"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${kind === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{k === "file" ? "PDF or video" : "Link"}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block text-sm">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2" /></label>
        <label className="block text-sm">Category
          <input value={category} onChange={(e) => setCategory(e.target.value)} list="resource-categories" placeholder="General" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2" />
          <datalist id="resource-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="block text-sm md:col-span-2">Description (optional)<input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2" /></label>
        {kind === "file"
          ? <label className="block text-sm md:col-span-2">File (PDF, MP4, MOV or WebM, up to 300 MB)<input type="file" accept="application/pdf,video/mp4,video/quicktime,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" /></label>
          : <label className="block text-sm md:col-span-2">Link<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2" /></label>}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-brand" disabled={!!busy || !title.trim()} onClick={() => void add()}>{busy || "Add"}</button>
        {msg && <span className="text-sm text-red-700">{msg}</span>}
      </div>
    </div>
  );
}

function ItemRow({ r, reload }: { r: Resource; reload: () => void }) {
  const [slug, setSlug] = useState(r.slug);
  const [msg, setMsg] = useState("");
  const patch = async (body: Record<string, unknown>) => {
    setMsg("");
    try { await hubPatch(`/api/resources/${r.id}`, body); reload(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <tr className={`border-t border-slate-800 ${r.isActive ? "" : "opacity-60"}`}>
      <td className="p-3"><span className="inline-flex items-center gap-2"><ResourceIcon r={r} className="w-4 h-4 text-slate-500" />{r.title}</span>
        {!r.isActive && <span className="ml-2 text-xs text-slate-500">{r.kind === "doc" ? "(no longer in the folder)" : "(hidden)"}</span>}</td>
      <td className="p-3">{r.category}</td>
      <td className="p-3">
        <span className="inline-flex items-center gap-1 text-slate-500">/resources/
          <input value={slug} onChange={(e) => setSlug(e.target.value)} onBlur={() => slug !== r.slug && void patch({ slug })}
            className="w-44 rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-100" aria-label={`Address for ${r.title}`} />
        </span>
        {msg && <div className="text-xs text-red-700">{msg}</div>}
      </td>
      <td className="p-3 text-right">
        {r.kind === "doc"
          ? <a className="btn-text" href={r.driveUrl ?? "#"} target="_blank" rel="noreferrer">Edit in Drive</a>
          : <button type="button" className="btn-text" onClick={() => void patch({ isActive: !r.isActive })}>{r.isActive ? "Hide" : "Show"}</button>}
      </td>
    </tr>
  );
}

function Manage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const load = () => hubGet<AdminData>("/api/resources/admin").then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  if (error) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  return (
    <div className="space-y-8">
      {data.scopes.map((s) => (
        <section key={s.scope} className="space-y-3">
          {data.scopes.length > 1 && <h2 className="text-xl font-semibold">{s.scope === "oms" ? "OMS-wide (every company)" : "Your company"}</h2>}
          <DriveFolder s={s} admin={data} reload={load} />
          <AddResource scope={s.scope} categories={[...new Set(s.items.map((i) => i.category))]} reload={load} />
          <div className="glass-card rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="p-3">Resource</th><th className="p-3">Category</th><th className="p-3">Address</th><th className="p-3" /></tr></thead>
              <tbody>{s.items.map((r) => <ItemRow key={`${r.id}-${r.slug}-${r.isActive}`} r={r} reload={load} />)}</tbody>
            </table>
            {!s.items.length && <div className="p-6 text-sm text-slate-500">Nothing here yet.</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ResourcesPage() {
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<"browse" | "manage">("browse");
  useEffect(() => { hubGet<{ canManage: boolean }>("/api/resources").then((d) => setCanManage(d.canManage)).catch(() => undefined); }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageTitle title="Resources">
          Policies, processes and tutorials. Documents are kept in Google Drive; what you see here is always the latest version.
        </PageTitle>
        {tab === "manage" && <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={() => setTab("browse")}>Back to Resources</button>}
      </div>
      {tab === "browse" ? <Browse onManage={canManage ? () => setTab("manage") : null} /> : <Manage />}
    </div>
  );
}
