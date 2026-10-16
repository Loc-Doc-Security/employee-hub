import type { Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import type { User } from "../../src/types";
import type { HubDirectoryEntry } from "../directory/hubDirectoryClient";

export const HUB_APP_ID = "employee-hub";

export type HubJwtClaims = {
  sub: string;
  email: string;
  name: string;
  apps: string[];
  iss: string;
  exp: number;
  iat: number;
};

type RegisterHubJwtOptions = {
  getUsers: () => User[];
  setUsers: (users: User[]) => void;
  persistState: () => Promise<void>;
  createId: (prefix: string) => string;
  normalizeEmail: (email: string) => string;
  fetchDirectoryEntry?: (hubUserId: string, token: string) => Promise<HubDirectoryEntry | null>;
};

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function verifyHubJwt(token: string, secret: string, issuer: string): HubJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", secret).update(data).digest();
  const actual = base64UrlDecode(sigB64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as HubJwtClaims;
    if (payload.iss !== issuer) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (!Array.isArray(payload.apps) || !payload.apps.includes(HUB_APP_ID)) return null;
    if (!payload.sub || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export function registerHubJwtAuth(options: RegisterHubJwtOptions) {
  const secret = process.env.HUB_JWT_SECRET?.trim();
  const issuer = process.env.HUB_JWT_ISSUER?.trim() || "lab-hub";
  const enabled = Boolean(secret) && process.env.HUB_AUTH_ENABLED === "1";

  const linkOrCreateUser = async (claims: HubJwtClaims, token: string): Promise<User | undefined> => {
    const email = options.normalizeEmail(claims.email);
    const dir = options.fetchDirectoryEntry ? await options.fetchDirectoryEntry(claims.sub, token) : null;
    let user =
      options.getUsers().find((u) => u.hubUserId === claims.sub) ??
      options.getUsers().find((u) => options.normalizeEmail(u.email) === email);
    if (user && !user.active) return undefined;
    const now = new Date().toISOString();
    const displayName = dir?.name?.trim() || claims.name?.trim() || claims.email.split("@")[0] || "User";
    if (!user) {
      user = {
        id: options.createId("u"),
        hubUserId: claims.sub,
        name: displayName,
        email,
        role: "EMPLOYEE",
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      options.setUsers([...options.getUsers(), user]);
      await options.persistState();
    } else if (!user.hubUserId || (dir?.name && user.name !== dir.name)) {
      const linked = options.getUsers().map((u) =>
        u.id === user!.id
          ? { ...u, hubUserId: claims.sub, name: dir?.name || u.name, updatedAt: now }
          : u,
      );
      options.setUsers(linked);
      user = linked.find((u) => u.id === user!.id);
      await options.persistState();
    }
    return user;
  };

  const getUserFromToken = (token: string): User | undefined => {
    if (!enabled || !secret) return undefined;
    const claims = verifyHubJwt(token, secret, issuer);
    if (!claims) return undefined;
    return (
      options.getUsers().find((u) => u.hubUserId === claims.sub && u.active) ??
      options.getUsers().find(
        (u) => options.normalizeEmail(u.email) === options.normalizeEmail(claims.email) && u.active,
      )
    );
  };

  const getUserFromRequest = (req: Request): User | undefined => {
    const authHeader = req.header("authorization");
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      const user = getUserFromToken(authHeader.slice(7).trim());
      if (user) return user;
    }
    const cookie = req.header("cookie") ?? "";
    const match = cookie.match(/(?:^|;\s*)lab_hub_token=([^;]+)/);
    if (match?.[1]) return getUserFromToken(decodeURIComponent(match[1]));
    return undefined;
  };

  return {
    enabled,
    getUserFromRequest,
    getUserFromToken,
    linkOrCreateUser,
    verifyHubJwt: (token: string) => (secret ? verifyHubJwt(token, secret, issuer) : null),
  };
}
