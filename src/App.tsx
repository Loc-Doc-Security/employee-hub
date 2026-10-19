import React, { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import LoginPage from "./components/LoginPage";
import AppShell from "./components/AppShell";
import HomePage from "./pages/HomePage";
import PeoplePage from "./pages/PeoplePage";
import WeeklyReportPage from "./pages/WeeklyReportPage";
import PeerAssessmentPage from "./pages/PeerAssessmentPage";
import CleanlinessAuditPage from "./pages/CleanlinessAuditPage";
import CleanlinessReportPage from "./pages/CleanlinessReportPage";
import OneOnOnePage from "./pages/OneOnOnePage";
import MyScorePage from "./pages/MyScorePage";
import TeamReportPage from "./pages/TeamReportPage";
import WednesdayMeetingPage from "./pages/WednesdayMeetingPage";
import TechSpotlightPage from "./pages/TechSpotlightPage";
import DriverScorecardPage from "./pages/DriverScorecardPage";
import CreditCardPage from "./pages/CreditCardPage";
import AdminPage from "./pages/AdminPage";
import ShopPage from "./pages/ShopPage";
import ShopAdminPage from "./pages/ShopAdminPage";
import ResourcesPage from "./pages/ResourcesPage";
import ResourceViewPage from "./pages/ResourceViewPage";
import BonusPage from "./pages/BonusPage";
import CalendarPage from "./pages/CalendarPage";
import { apiGet } from "./lib/api";
import { HUB_APP_ID } from "./lib/brand";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { authStatus, loading } = useApp();
  const location = useLocation();
  const [hubRedirect, setHubRedirect] = useState<string | null>(null);
  useEffect(() => {
    if (authStatus !== "guest") return;
    void apiGet<{ hubAuthEnabled?: boolean; hubAppUrl?: string }>("/api/auth/config").then((c) => {
      if (c.hubAuthEnabled && c.hubAppUrl) {
        setHubRedirect(`${c.hubAppUrl}/login?return=${encodeURIComponent(window.location.origin)}&app=${HUB_APP_ID}`);
      }
    });
  }, [authStatus]);
  if (loading || authStatus === "unknown") return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (authStatus === "guest") {
    if (hubRedirect) {
      window.location.href = hubRedirect;
      return null;
    }
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<RequireAuth><Routes><Route path="/" element={<AppShell />}><Route index element={<HomePage />} /><Route path="people" element={<PeoplePage />} /><Route path="weekly-report" element={<WeeklyReportPage />} /><Route path="peer-assessments" element={<PeerAssessmentPage />} /><Route path="cleanliness" element={<CleanlinessAuditPage />} /><Route path="cleanliness/report" element={<CleanlinessReportPage />} /><Route path="one-on-ones" element={<OneOnOnePage />} /><Route path="my-score" element={<MyScorePage />} /><Route path="team-report" element={<TeamReportPage />} /><Route path="wednesday-meeting" element={<WednesdayMeetingPage />} /><Route path="tech-spotlight" element={<TechSpotlightPage />} /><Route path="driver-scorecard" element={<DriverScorecardPage />} /><Route path="credit-card" element={<CreditCardPage />} /><Route path="admin" element={<AdminPage />} /><Route path="shop" element={<ShopPage />} /><Route path="shop-admin" element={<ShopAdminPage />} /><Route path="resources" element={<ResourcesPage />} /><Route path="resources/:slug" element={<ResourceViewPage />} /><Route path="bonus" element={<BonusPage />} /><Route path="calendar" element={<CalendarPage />} /></Route></Routes></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}