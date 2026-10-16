import React, { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import LoginPage from "./components/LoginPage";
import AppShell from "./components/AppShell";
import HomePage from "./components/HomePage";
import PeoplePage from "./pages/PeoplePage";
import WeeklyReportPage from "./pages/WeeklyReportPage";
import PeerAssessmentPage from "./pages/PeerAssessmentPage";
import CleanlinessAuditPage from "./pages/CleanlinessAuditPage";
import CleanlinessReportPage from "./pages/CleanlinessReportPage";
import OneOnOnePage from "./pages/OneOnOnePage";
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
          <Route path="/*" element={<RequireAuth><Routes><Route path="/" element={<AppShell />}><Route index element={<HomePage />} /><Route path="people" element={<PeoplePage />} /><Route path="weekly-report" element={<WeeklyReportPage />} /><Route path="peer-assessments" element={<PeerAssessmentPage />} /><Route path="cleanliness" element={<CleanlinessAuditPage />} /><Route path="cleanliness/report" element={<CleanlinessReportPage />} /><Route path="one-on-ones" element={<OneOnOnePage />} /></Route></Routes></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}