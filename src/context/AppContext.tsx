import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { User } from "../types";
import { apiGet, apiPost } from "../lib/api";
import { clearAuthTokens, getAuthToken, setAuthToken, clearHubAuthFailed, markHubAuthFailed } from "../lib/authToken";

type AuthStatus = "unknown" | "guest" | "signed-in";

const AppContext = createContext<{
  authStatus: AuthStatus;
  currentUser: User | null;
  loading: boolean;
  signIn: (u: string, p: string) => Promise<void>;
  signOut: () => Promise<void>;
} | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("unknown");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    try {
      const hubToken = params.get("hub_token");
      if (hubToken) {
        setAuthToken(hubToken, true);
        clearHubAuthFailed();
        window.history.replaceState({}, "", window.location.pathname);
      }
      if (!getAuthToken()) {
        setAuthStatus("guest");
        return;
      }
      const { user } = await apiGet<{ user: User }>("/api/auth/session");
      setCurrentUser(user);
      setAuthStatus("signed-in");
    } catch {
      if (params.get("hub_token")) markHubAuthFailed();
      clearAuthTokens();
      setAuthStatus("guest");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(async (username: string, password: string) => {
    const { token, user } = await apiPost<{ token: string; user: User }>("/api/auth/login", { username, password });
    setAuthToken(token, true);
    setCurrentUser(user);
    setAuthStatus("signed-in");
  }, []);

  const signOut = useCallback(async () => {
    await apiPost("/api/auth/logout").catch(() => undefined);
    clearAuthTokens();
    setCurrentUser(null);
    setAuthStatus("guest");
  }, []);

  const value = useMemo(
    () => ({ authStatus, currentUser, loading, signIn, signOut }),
    [authStatus, currentUser, loading, signIn, signOut],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp required");
  return ctx;
}