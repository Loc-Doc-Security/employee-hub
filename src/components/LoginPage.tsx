import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { apiGet } from "../lib/api";
import { HUB_APP_ID, PRODUCT_NAME } from "../lib/brand";
import HubBackLink from "./HubBackLink";
import LabLogo from "./LabLogo";

export default function LoginPage() {
  const { signIn, authStatus } = useApp();
  const navigate = useNavigate();
  const [hubLoginUrl, setHubLoginUrl] = useState<string | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");

  useEffect(() => {
    if (authStatus === "signed-in") navigate("/", { replace: true });
  }, [authStatus, navigate]);

  useEffect(() => {
    void apiGet<{ hubAuthEnabled?: boolean; hubAppUrl?: string }>("/api/auth/config").then((c) => {
      if (c.hubAuthEnabled && c.hubAppUrl) {
        setHubLoginUrl(
          `${c.hubAppUrl.replace(/\/$/, "")}/login?return=${encodeURIComponent(location.origin)}&app=${HUB_APP_ID}`,
        );
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="glass-card rounded-[2rem] border border-white/10 p-10 max-w-md w-full space-y-6">
        <div className="text-center space-y-3">
          <LabLogo size="lg" />
          <HubBackLink />
          <h1 className="text-2xl font-bold text-white">{PRODUCT_NAME}</h1>
        </div>
        {hubLoginUrl ? (
          <a href={hubLoginUrl} className="btn-brand w-full block text-center">
            SIGN IN WITH LAB HUB
          </a>
        ) : null}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn(username, password).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
          }}
        >
          <input className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          <input type="password" className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error ? <p className="text-rose-400 text-sm">{error}</p> : null}
          <button type="submit" className="btn-brand w-full">Sign in</button>
        </form>
      </div>
    </div>
  );
}