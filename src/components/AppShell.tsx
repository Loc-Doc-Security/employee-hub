import { Outlet, Link, useLocation } from "react-router-dom";
import { CalendarDays, ClipboardCheck, ClipboardList, CreditCard, Home, Lightbulb, LogOut, MessagesSquare, SprayCan, Star, Trophy, Truck, Users } from "lucide-react";
import { useMe } from "../lib/hubApi";
import { LabSideNav } from "lab-theme/LabSideNav";
import HubBackLink from "./HubBackLink";
import LabLogo from "./LabLogo";
import ViewAsPicker from "./ViewAsPicker";
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
  const { me } = useMe();
  const canTeamReport = !!me?.permissions["reports.view_team"];
  const canMeetings = !!me?.permissions["meetings.manage"];
  const canDriverScorecard = !!me?.permissions["driver_scorecard.upload"];
  const header = (
    <>
      <div className="pb-2">
        <BrandBlock />
      </div>
      <div className="px-2 pb-2">
        <HubBackLink />
      </div>
    </>
  );
  const nav = (
    <LabSideNav
      className={`w-64 shrink-0 self-stretch min-h-screen${side === "right" ? " lab-sidebar--right" : ""}`}
      header={header}
      quickLinks={[{ to: "/", label: "Home", icon: Home }, { to: "/my-score", label: "My Score", icon: Trophy }, { to: "/people", label: "People", icon: Users }, { to: "/weekly-report", label: "Weekly Report", icon: ClipboardCheck }, { to: "/peer-assessments", label: "Peer Assessments", icon: Star }, { to: "/cleanliness", label: "Cleanliness Audit", icon: SprayCan }, { to: "/one-on-ones", label: "1:1s", icon: MessagesSquare }, { to: "/tech-spotlight", label: "Tech Spotlight", icon: Lightbulb }, { to: "/credit-card", label: "Credit Card Receipts", icon: CreditCard }, { to: "/team-report", label: "Team Report", icon: ClipboardList, show: canTeamReport }, { to: "/wednesday-meeting", label: "Wednesday Meeting", icon: CalendarDays, show: canMeetings }, { to: "/driver-scorecard", label: "Driver Scorecard", icon: Truck, show: canDriverScorecard }]}
      sections={[]}
      footer={<><ViewAsPicker /><SignOutButton /></>}
    />
  );
  return (
    <div className="min-h-screen flex">
      {side === "left" ? nav : null}
      <main className="min-w-0 flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
      {side === "right" ? nav : null}
    </div>
  );
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
