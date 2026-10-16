import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";

type HubConsumeResult = {
  accountId: string;
  email: string;
  name: string;
  providerId: string | null;
};

export async function consumeHubHandoffToken(
  rawToken: string,
  appId: string,
): Promise<HubConsumeResult | null> {
  const hubUrl = (process.env.HUB_APP_URL ?? "http://localhost:3002").replace(/\/$/, "");
  const secret = process.env.HUB_JWT_SECRET?.trim();
  if (!secret) return null;
  try {
    const res = await fetch(`${hubUrl}/api/internal/handoff/consume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Internal-Secret": secret,
      },
      body: JSON.stringify({ token: rawToken, appId }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data?: HubConsumeResult };
    return json.ok && json.data ? json.data : null;
  } catch {
    return null;
  }
}

export function registerHubExchangeRoute(
  app: Express,
  options: {
    appId: string;
    issueSession: (req: Request, res: Response, account: HubConsumeResult) => void | Promise<void>;
    sendError: (res: Response, status: number, message: string) => void;
  },
) {
  app.get("/api/auth/hub-exchange", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!token) {
      options.sendError(res, 400, "token required");
      return;
    }
    const consumed = await consumeHubHandoffToken(token, options.appId);
    if (!consumed) {
      options.sendError(res, 401, "Invalid or expired handoff token");
      return;
    }
    await options.issueSession(req, res, consumed);
  });
}

export function createAppSessionToken(): string {
  return randomUUID();
}
