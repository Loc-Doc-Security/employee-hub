// The signed-in app frame (Levi, 2026-10-19). Desktop: a slim icon rail is always there; expanding
// opens the full OMST sidebar (LabSideNav, unchanged) as a full-height panel that FLOATS over the
// page, or, if pinned, DOCKS beside it (remembered per browser). The whole panel scrolls as one,
// and only the current page's group starts open, so it fits a laptop screen. Phones: a top bar with
// ☰ opens the same panel as a drawer. Styles: src/styles/hub.css.
import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Pin, X } from "lucide-react";
import { LabSideNav } from "lab-theme/LabSideNav";
import HubBackLink from "./HubBackLink";
import { useApp } from "../context/AppContext";
import { useMe } from "../lib/hubApi";
import { HOME, navFor } from "../lib/nav";
import { PRODUCT_NAME } from "../lib/brand";
import "../styles/hub.css";

const PINNED_KEY = "hub.nav.pinned";

function usePinned(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem(PINNED_KEY) === "1"; } catch { return false; }
  });
  const set = (next: boolean) => {
    setV(next);
    try { localStorage.setItem(PINNED_KEY, next ? "1" : "0"); } catch { /* not remembered */ }
  };
  return [v, set];
}

/** The person's company logo (public/logos/<company>.png), or the product name if there isn't one. */
function Brand({ slug }: { slug?: string }) {
  const [failed, setFailed] = useState(false);
  if (!slug || failed) return <span className="text-sm font-black truncate">{PRODUCT_NAME}</span>;
  return <img src={`/logos/${slug}.png`} alt={PRODUCT_NAME} className="hub-brand-logo" onError={() => setFailed(true)} />;
}

function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

type Mode = "floating" | "pinned" | "drawer";

export default function HubShell({ side = "left", footer }: { side?: "left" | "right"; footer?: ReactNode }) {
  const { me } = useMe();
  const { signOut } = useApp();
  const { pathname } = useLocation();
  const [pinned, setPinned] = usePinned();
  const [open, setOpen] = useState(false); // floating panel (desktop) or drawer (phone)
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const groups = navFor(me);
  // Only the group holding the current page starts open (My work on Home); the rest are a click away.
  const openGroup = groups.find((g) => g.items.some((i) => isActive(pathname, i.to)))?.id ?? "work";

  const panel = (mode: Mode) => (
    <LabSideNav
      // LabSideNav decides which groups are open on first draw; redraw once permissions load and when the page moves to another group.
      key={`${mode}-${openGroup}-${groups.map((g) => g.id).join(",")}`}
      className={`hub-navpanel w-64 shrink-0${mode === "pinned" ? " hub-navpanel--docked" : ""}${side === "right" ? " lab-sidebar--right" : ""}`}
      header={
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-1 px-1">
            <Link to="/" className="min-w-0"><Brand slug={me?.employee?.company_slug} /></Link>
            <span className="flex shrink-0">
              {mode === "floating" && <button type="button" className="hub-nav-toggle hidden md:inline-flex" aria-label="Pin menu open" title="Pin menu open" onClick={() => { setPinned(true); setOpen(false); }}><Pin /></button>}
              {mode === "pinned"
                ? <button type="button" className="hub-nav-toggle" aria-label="Collapse menu" title="Collapse menu" onClick={() => setPinned(false)}><PanelLeftClose /></button>
                : <button type="button" className="hub-nav-toggle" aria-label="Close menu" title="Close menu" onClick={() => setOpen(false)}><X /></button>}
            </span>
          </div>
          <div className="px-1"><HubBackLink /></div>
        </div>
      }
      quickLinks={[HOME]}
      sections={groups.map((g) => ({ id: g.id, label: g.label, defaultOpen: g.id === openGroup, items: g.items }))}
      footer={footer}
      onNavigate={mode === "pinned" ? undefined : () => setOpen(false)}
    />
  );

  const rail = (
    <nav className={`lab-sidebar hub-rail${side === "right" ? " lab-sidebar--right" : ""}`} aria-label="Main menu">
      <button type="button" className="hub-nav-toggle mb-1" aria-label="Open menu" title="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><PanelLeftOpen /></button>
      <div className="hub-rail__items custom-scrollbar">
        {[[HOME], ...groups.map((g) => g.items)].map((items, i) => (
          <div key={i} className="contents">
            {i > 0 && <div className="hub-rail__sep" role="separator" />}
            {items.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} title={label} aria-label={label}
                className={`hub-rail__link${isActive(pathname, to) ? " hub-rail__link--active" : ""}`}><Icon /></Link>
            ))}
          </div>
        ))}
      </div>
      <button type="button" className="hub-nav-toggle mt-1" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut /></button>
    </nav>
  );

  return (
    <div className={`hub-shell min-h-screen md:flex${side === "right" ? " md:flex-row-reverse" : ""}`}>
      {/* Phones: top bar + drawer */}
      <div className="hub-topbar md:hidden">
        <button type="button" className="hub-nav-toggle" aria-label="Open menu" onClick={() => setOpen(true)}><Menu /></button>
        <Link to="/" className="min-w-0"><Brand slug={me?.employee?.company_slug} /></Link>
      </div>
      <div className="md:hidden h-[3.25rem]" aria-hidden />{/* room for the fixed top bar */}
      {open && (
        <>
          <div className="hub-drawer-backdrop" onClick={() => setOpen(false)} />
          <div className={`hub-drawer${side === "right" ? " hub-drawer--right" : ""}`}>{panel("floating")}</div>
        </>
      )}
      {/* Desktop: docked panel when pinned, otherwise the rail. Both are fixed to the window (the
          theme's overflow-x: hidden on html/body/#root stops position: sticky from working), so this
          spacer holds their width in the layout. */}
      <div className={`hidden md:block shrink-0 hub-nav-spacer${pinned ? " hub-nav-spacer--wide" : ""}`}>
        <div className={side === "right" ? "hub-fixed-right" : "hub-fixed-left"}>{pinned ? panel("pinned") : rail}</div>
      </div>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
