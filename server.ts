import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import type { User } from "./src/types";
import { createRepository } from "./server/repositories";
import { loadInitialSeedFile } from "./server/data/loadInitialSeed";
import { registerHubJwtAuth } from "./server/auth/hubJwt";
import { fetchDirectoryEntry } from "./server/directory/hubDirectoryClient";
import { FARGATE_LISTEN_HOST, parseListenPort, validateSqlBackendEnv } from "./server/deployment/containerRuntime";
import { loadPlatformSecrets } from "./server/platform/loadPlatformSecrets";
import { applyLocdocPlatformEnv } from "./server/platform/applyPlatformEnv";

if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite writes the UI to /app/dist. The production server is /app/dist-server/server.mjs.
 * ECS command `node dist-server/server.mjs` is correct — do not change the working
 * directory away from /app. Check cwd, the folder above the bundle, and next to the
 * bundle so both new images and older `__dirname + "/dist"` apps find the files.
 */
function resolveProductionFrontendDist(): string | null {
  const candidates = [
    path.join(process.cwd(), "dist"),
    path.join(__dirname, "..", "dist"),
    path.join(__dirname, "dist"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  console.error(`[startup] Frontend bundle missing. Looked in: ${candidates.join(", ")}`);
  return null;
}

async function startServer() {
  await loadPlatformSecrets();
  applyLocdocPlatformEnv();
  const envCheck = validateSqlBackendEnv(process.env);
  for (const w of envCheck.warnings) console.warn(`[env] ${w}`);
  if (envCheck.errors.length && process.env.NODE_ENV === "production") {
    throw new Error(envCheck.errors.join("; "));
  }

  const seed = loadInitialSeedFile();
  const repository = await createRepository(seed);
  let users = (await repository.load()).users;
  let authCredentials: Record<string, { userId: string; passwordHash: string }> = {};

  if (process.env.NODE_ENV !== "production" && process.env.LAB_DEV_SIMPLE_AUTH === "1") {
    const admin = users.find((u) => u.role === "ADMIN");
    if (admin) {
      authCredentials.admin = {
        userId: admin.id,
        passwordHash: await bcrypt.hash(process.env.LAB_BOOTSTRAP_ADMIN_PASSWORD?.trim() || "admin", 10),
      };
    }
  }

  const authSessions = new Map<string, { userId: string; expiresAt: number }>();
  const persistState = async () => repository.save({ users, authCredentials });
  const sendOk = (res: express.Response, body: unknown) => res.json({ ok: true, data: body });
  const sendError = (res: express.Response, status: number, message: string) =>
    res.status(status).json({ ok: false, error: message });
  const createId = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;
  const normalizeEmail = (e: string) => e.trim().toLowerCase();

  const hubJwt = registerHubJwtAuth({
    getUsers: () => users,
    setUsers: (n) => {
      users = n;
    },
    persistState,
    createId,
    normalizeEmail,
    fetchDirectoryEntry,
  });

  const getAuthUser = (req: express.Request) => {
    const hub = hubJwt.getUserFromRequest(req);
    if (hub) return hub;
    const h = req.header("authorization");
    const token = h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
    const session = token ? authSessions.get(token) : undefined;
    if (!session || session.expiresAt < Date.now()) return undefined;
    return users.find((u) => u.id === session.userId && u.active);
  };

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
  app.use(express.json());

  app.get("/api/health", async (_req, res) => {
    let productDb: "skipped" | "ok" | "error" = "skipped";
    try {
      const { pingProductDb } = await import("./server/db/index");
      productDb = await pingProductDb();
    } catch {
      productDb = "skipped";
    }
    sendOk(res, {
      status: "ok",
      service: "employee-hub-api",
      productDb,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/auth/config", (_req, res) =>
    sendOk(res, {
      hubAuthEnabled: process.env.HUB_AUTH_ENABLED === "1",
      hubAppUrl: process.env.HUB_APP_URL?.replace(/\/$/, ""),
      hubAppId: "employee-hub",
      developmentAuth: process.env.LAB_DEV_SIMPLE_AUTH === "1",
    }),
  );

  app.post("/api/auth/login", async (req, res) => {
    const hubBlocksLocalLogin =
      process.env.HUB_AUTH_ENABLED === "1" &&
      (process.env.NODE_ENV === "production" || process.env.HUB_AUTH_STRICT === "1");
    if (hubBlocksLocalLogin) {
      return sendError(res, 403, "Sign in via Lab Hub");
    }
    const user = authCredentials.admin;
    const ok =
      user &&
      req.body?.username === "admin" &&
      (await bcrypt.compare(String(req.body?.password ?? ""), user.passwordHash));
    if (!ok) return sendError(res, 401, "Invalid credentials");
    const row = users.find((u) => u.id === user!.userId);
    if (!row) return sendError(res, 401, "Invalid credentials");
    const token = randomUUID();
    authSessions.set(token, { userId: row.id, expiresAt: Date.now() + 86400000 });
    return sendOk(res, { token, user: row });
  });

  app.get("/api/auth/session", async (req, res) => {
    let user = getAuthUser(req);
    const h = req.header("authorization");
    let token = h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
    if (!user && token) {
      const claims = hubJwt.verifyHubJwt(token);
      if (claims) user = await hubJwt.linkOrCreateUser(claims, token);
    }
    if (!user) return sendError(res, 401, "Not authenticated");
    return sendOk(res, { user });
  });

  app.post("/api/auth/logout", (req, res) => {
    const h = req.header("authorization");
    const token = h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
    if (token) authSessions.delete(token);
    return sendOk(res, { ok: true });
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as { token?: string })?.token ??
      (typeof socket.handshake.headers.authorization === "string"
        ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, "")
        : "");
    if (!token) return next(new Error("Authentication required"));
    const hubUser = hubJwt.getUserFromToken(token);
    if (hubUser) {
      (socket.data as { userId?: string }).userId = hubUser.id;
      return next();
    }
    const session = authSessions.get(token);
    if (!session || session.expiresAt < Date.now()) return next(new Error("Authentication required"));
    (socket.data as { userId?: string }).userId = session.userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId = (socket.data as { userId?: string }).userId;
    if (userId) void socket.join(`user:${userId}`);
    socket.on("disconnect", () => undefined);
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = resolveProductionFrontendDist();
    if (!distPath) {
      app.use((_req, res) => res.status(503).send("Frontend bundle missing. Run npm run build."));
    } else {
      const indexHtml = path.join(distPath, "index.html");
      app.use(express.static(distPath));
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        res.sendFile(path.resolve(indexHtml));
      });
    }
  }

  const port = parseListenPort();
  httpServer.listen(port, FARGATE_LISTEN_HOST, () => {
    console.info(`[employee-hub] Employee Hub on :${port}`);
  });
}

startServer().catch((e) => {
  console.error(e);
  process.exit(1);
});