// One resource at its stable address, /resources/<slug>. Docs are shown read-only (Google's own
// formatting, in a sandboxed frame with scripts off); "Open in Google Drive" goes to the Doc, where
// Drive decides who may edit. PDFs and videos stream through a short-lived signed link.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { hubGet } from "../lib/hubApi";
import { ResourceIcon, type Resource } from "./ResourcesPage";

type Full = Resource & { html: string | null; fileUrl: string | null };

/** YouTube and Vimeo links play in the page; anything else opens in a new tab. */
function embedFor(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

const frame = "w-full rounded-2xl border border-slate-200 bg-white";

export default function ResourceViewPage() {
  const { slug = "" } = useParams();
  const [r, setR] = useState<Full | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setR(null); setError("");
    hubGet<Full>(`/api/resources/by-slug/${encodeURIComponent(slug)}`).then(setR).catch((e: Error) => setError(e.message));
  }, [slug]);

  const back = <Link to="/resources" className="btn-text inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Resources</Link>;
  if (error) return <div className="space-y-3">{back}<div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div></div>;
  if (!r) return <div className="text-sm text-slate-500">Loading…</div>;
  const embed = r.kind === "link" && r.url ? embedFor(r.url) : null;
  const isVideo = r.contentType?.startsWith("video/");

  return (
    <div className="space-y-4">
      {back}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex gap-3 min-w-0">
          <span className="mt-2 text-slate-500"><ResourceIcon r={r} className="w-6 h-6" /></span>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold">{r.title}</h1>
            <p className="text-sm text-slate-500">{r.category} · updated {new Date(r.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{r.scope === "oms" ? " · OMS-wide" : ""}</p>
            {r.description && <p className="text-sm text-slate-600 mt-1">{r.description}</p>}
          </div>
        </div>
        {r.kind === "doc" && r.driveUrl && (
          <a className="rounded-xl border border-slate-300 px-4 py-2 text-sm inline-flex items-center gap-2" href={r.driveUrl} target="_blank" rel="noreferrer">
            Open in Google Drive <ExternalLink className="w-4 h-4" /></a>
        )}
        {r.kind === "link" && r.url && (
          <a className="btn-brand inline-flex items-center gap-2" href={r.url} target="_blank" rel="noreferrer">Open link <ExternalLink className="w-4 h-4" /></a>
        )}
        {r.kind === "file" && r.fileUrl && (
          <a className="rounded-xl border border-slate-300 px-4 py-2 text-sm inline-flex items-center gap-2" href={r.fileUrl} target="_blank" rel="noreferrer">
            {isVideo ? "Open video" : "Open PDF"} <ExternalLink className="w-4 h-4" /></a>
        )}
      </div>

      {r.kind === "doc" && (r.html
        ? <iframe title={r.title} srcDoc={r.html} sandbox="allow-popups allow-popups-to-escape-sandbox" className={frame} style={{ height: "calc(100vh - 220px)", minHeight: 480 }} />
        : <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">This Doc hasn't been synced from Drive yet. Open it in Google Drive for now.</div>)}
      {r.kind === "file" && r.fileUrl && (isVideo
        ? <video controls preload="metadata" src={r.fileUrl} className="w-full rounded-2xl bg-black max-h-[75vh]" />
        : <iframe title={r.title} src={r.fileUrl} className={frame} style={{ height: "calc(100vh - 220px)", minHeight: 480 }} />)}
      {embed && (
        <div className="aspect-video w-full">
          <iframe title={r.title} src={embed} className="w-full h-full rounded-2xl border border-slate-200" allow="fullscreen; picture-in-picture" allowFullScreen />
        </div>
      )}
    </div>
  );
}
