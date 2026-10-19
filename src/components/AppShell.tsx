import { Outlet, Link, useLocation } from "react-router-dom";
import { Home, LogOut } from "lucide-react";
import HubBackLink from "./HubBackLink";
import LabLogo from "./LabLogo";
import ViewAsPicker from "./ViewAsPicker";
import HubShell from "./HubShell";
import { useApp } from "../context/AppContext";
import { NAV_LAYOUT, PRODUCT_NAME } from "../lib/brand";

function BrandBlock() {
  return (
    <div className="flex items-center gap-3 px-2">
      <LabLogo size="sm" />
      <span className="text-sm font-black truncate">{PRODUCT_NAME}</span>
    </div>
  );
}

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const { currentUser, signOut } = useApp();
  return (
    <button
      type="button"
      className={`btn-text justify-start ${compact ? "" : "w-full"}`}
      onClick={() => void signOut()}
    >
      <LogOut className="w-4 h-4" /> Sign out ({currentUser?.name})
    </button>
  );
}

function TopNavLinks() {
  const { pathname } = useLocation();
  const active = pathname === "/";
  return (
    <nav className="flex items-center gap-1">
      <Link
        to="/"
        className={`lab-nav-link lab-nav-link--quick inline-flex items-center gap-2 px-3 py-2 rounded-lg ${
          active ? "lab-nav-link--active" : ""
        }`}
      >
        <Home className="w-4 h-4" />
        Home
      </Link>
    </nav>
  );
}

function SideShell({ side }: { side: "left" | "right" }) {
  return <HubShell side={side} footer={<><ViewAsPicker /><SignOutButton /></>} />;
}

function TopUnderShell() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200/80 bg-[var(--lab-surface,#fefefe)]">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <BrandBlock />
          <div className="flex items-center gap-3">
            <HubBackLink />
            <SignOutButton compact />
          </div>
        </div>
        <div className="px-4 pb-2 border-t border-slate-100">
          <TopNavLinks />
        </div>
      </header>
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function TopInlineShell() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200/80 bg-[var(--lab-surface,#fefefe)]">
        <div className="flex items-center gap-4 px-4 py-3 flex-wrap">
          <BrandBlock />
          <TopNavLinks />
          <div className="ml-auto flex items-center gap-3">
            <HubBackLink />
            <SignOutButton compact />
          </div>
        </div>
      </header>
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default function AppShell() {
  const layout = NAV_LAYOUT;
  if (layout === "right") return <SideShell side="right" />;
  if (layout === "top-under") return <TopUnderShell />;
  if (layout === "top-inline") return <TopInlineShell />;
  return <SideShell side="left" />;
}
