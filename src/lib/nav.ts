// Every place you can go in the hub, in one list. The sidebar, the collapsed icon rail and the Home
// tiles all read this, so they can't drift apart. `permission` hides an item from people who can't
// use it (the server still enforces access either way).
import type { ComponentType } from "react";
import {
  BadgeDollarSign, BookOpen, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, CreditCard, Home, Lightbulb,
  MessagesSquare, ShieldCheck, ShoppingBag, SprayCan, Star, Store, Trophy, Truck, Users,
} from "lucide-react";
import type { Me } from "./hubApi";

export type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; description: string; permission?: string };
export type NavGroup = { id: string; label: string; items: NavItem[] };

export const HOME: NavItem = { to: "/", label: "Home", icon: Home, description: "What's due this week" };

export const NAV_GROUPS: NavGroup[] = [
  { id: "work", label: "My work", items: [
    { to: "/weekly-report", label: "Weekly Report", icon: ClipboardCheck, description: "Tell leadership how your week went" },
    { to: "/cleanliness", label: "Cleanliness Audit", icon: SprayCan, description: "Your vehicle and office, every week" },
    { to: "/peer-assessments", label: "Peer Assessments", icon: Star, description: "Rate your teammates each month" },
    { to: "/tech-spotlight", label: "Tech Spotlight", icon: Lightbulb, description: "Share a problem you solved" },
    { to: "/my-score", label: "My Score", icon: Trophy, description: "Your monthly score and level" },
    { to: "/one-on-ones", label: "1:1s", icon: MessagesSquare, description: "Your one-on-ones with your manager" },
    { to: "/credit-card", label: "Credit Card", icon: CreditCard, description: "Receipts uploaded vs. purchases" },
  ] },
  { id: "company", label: "Company", items: [
    { to: "/calendar", label: "Calendar", icon: CalendarRange, description: "Holidays, events, who's out" },
    { to: "/resources", label: "Resources", icon: BookOpen, description: "Policies, processes and tutorials" },
    { to: "/people", label: "People", icon: Users, description: "Everyone in the company" },
    { to: "/shop", label: "Shop", icon: ShoppingBag, description: "Uniforms and gear, with your points" },
  ] },
  { id: "manager", label: "Manager", items: [
    { to: "/team-report", label: "Team Report", icon: ClipboardList, description: "How your team is doing", permission: "reports.view_team" },
    { to: "/wednesday-meeting", label: "Wednesday Meeting", icon: CalendarDays, description: "The meeting deck and schedule", permission: "meetings.manage" },
    { to: "/driver-scorecard", label: "Driver Scorecard", icon: Truck, description: "Weekly Geotab driver scores", permission: "driver_scorecard.upload" },
  ] },
  { id: "admin", label: "Admin", items: [
    { to: "/admin", label: "Admin", icon: ShieldCheck, description: "People, roles and departments", permission: "employees.manage" },
    { to: "/shop-admin", label: "Shop Admin", icon: Store, description: "Orders, catalog and points", permission: "shop.admin" },
    { to: "/bonus", label: "Bonus Calculator", icon: BadgeDollarSign, description: "Monthly bonus pool and payouts", permission: "bonus.manage" },
  ] },
];

/** The groups and items this person can use (empty groups dropped). */
export function navFor(me: Me | null): NavGroup[] {
  const can = (i: NavItem) => !i.permission || !!me?.permissions[i.permission];
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(can) })).filter((g) => g.items.length > 0);
}
