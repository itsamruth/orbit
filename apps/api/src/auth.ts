import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import { registerEmail } from "./email.js";
import type { SqlDatabase } from "@orbit/local-store";
import { DomainError } from "@orbit/local-store";
import type { Account } from "@orbit/contracts";
import { isAllowedBrowserOrigin } from "./origin.js";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const time = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();
export interface AuthConfig {
  origin: string;
  githubClientId?: string;
  githubClientSecret?: string;
  devAuth?: boolean;
  sendEmail?: (email: string, url: string) => Promise<void>;
}
export async function registerAuth(
  app: FastifyInstance,
  db: SqlDatabase,
  config: AuthConfig,
) {
  app.get("/api/v1/auth/config", async () => ({
    mode: config.devAuth ? "local" : "hosted",
    origin: config.origin,
    email: Boolean(config.sendEmail || (process.env.ORBIT_SMTP_URL && process.env.ORBIT_MAIL_FROM)),
    github: Boolean(config.githubClientId && config.githubClientSecret),
  }));
  const secure = config.origin.startsWith("https://");
  const cookie = {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
  };
  if (config.devAuth && process.env.NODE_ENV === "production")
    throw new Error("Development authentication cannot run in production");
  if (config.devAuth) {
    await db.query(
      "INSERT INTO orbit_accounts (id,login,avatar_url) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
      ["usr_local", "local", null],
    );
  }
  async function account(req: FastifyRequest): Promise<Account> {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    const token = bearer ?? req.cookies.orbit_session;
    if (!bearer && req.method !== "GET" && req.method !== "HEAD") {
      if (!isAllowedBrowserOrigin(req.headers.origin, config.origin))
        throw new DomainError(403, "Request origin is not allowed");
    }
    if (!token) {
      if (config.devAuth)
        return { id: "usr_local", login: "local", avatarUrl: null };
      throw new DomainError(401, "Sign in to Orbit to continue");
    }
    const rows = await db.query<{
      id: string;
      login: string;
      avatar_url: string | null;
      kind: string;
    }>(
      "SELECT a.id,a.login,a.avatar_url,c.kind FROM orbit_credentials c JOIN orbit_accounts a ON a.id=c.user_id WHERE c.hash=$1 AND c.expires_at>$2",
      [hash(token), time(0)],
    );
    const a = rows[0];
    if (!a || (bearer ? a.kind !== "cli" : a.kind !== "web"))
      throw new DomainError(
        401,
        "Your session expired or this device was revoked",
      );
    await db.query(
      "UPDATE orbit_credentials SET last_seen_at=$1 WHERE hash=$2",
      [time(0), hash(token)],
    );
    return { id: a.id, login: a.login, avatarUrl: a.avatar_url };
  }
  async function issue(userId: string, kind: string, name: string, dbx = db) {
    const token = secret(),
      deviceId = "dev_" + randomUUID(),
      now = time(0);
    await dbx.query(
      "INSERT INTO orbit_credentials (hash,user_id,kind,device_id,name,created_at,expires_at,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        hash(token),
        userId,
        kind,
        deviceId,
        name,
        now,
        time(kind === "web" ? 604800 : 2592000),
        now,
      ],
    );
    return token;
  }
  app.get("/api/v1/auth/github", async (req, reply) => {
    if (!config.githubClientId || !config.githubClientSecret)
      throw new DomainError(
        503,
        "GitHub sign-in is not configured. Use demo mode or configure the OAuth application.",
      );
    const state = secret();
    await db.query(
      "INSERT INTO orbit_oauth_states (hash,expires_at) VALUES ($1,$2)",
      [hash(state), time(600)],
    );
    const returnTo =
      (req.query as { returnTo?: string }).returnTo ?? "/workspace";
    const destination = new URL(returnTo, config.origin);
    if (
      destination.origin !== config.origin ||
      !["/", "/workspace", "/projects", "/device", "/onboarding"].includes(destination.pathname)
    )
      throw new DomainError(400, "Invalid return path");
    reply.setCookie("orbit_return", destination.pathname + destination.search, {
      ...cookie,
      maxAge: 600,
    });
    reply.setCookie("orbit_oauth", state, { ...cookie, maxAge: 600 });
    const u = new URL("https://github.com/login/oauth/authorize");
    u.searchParams.set("client_id", config.githubClientId);
    u.searchParams.set(
      "redirect_uri",
      config.origin + "/api/v1/auth/github/callback",
    );
    u.searchParams.set("state", state);
    u.searchParams.set("scope", "read:user");
    return reply.redirect(u.toString());
  });
  app.get(
    "/api/v1/auth/github/callback",
    {
      schema: {
        querystring: Type.Object({
          code: Type.String({ maxLength: 2000 }),
          state: Type.String({ maxLength: 2000 }),
        }),
      },
    },
    async (req, reply) => {
      const { code, state } = req.query as { code: string; state: string };
      if (!state || state !== req.cookies.orbit_oauth)
        throw new DomainError(403, "Invalid sign-in state");
      await db.transaction(async (tx) => {
        const rows = await tx.query(
          "SELECT hash FROM orbit_oauth_states WHERE hash=$1 AND expires_at>$2",
          [hash(state), time(0)],
        );
        if (!rows.length) throw new DomainError(403, "Sign-in expired");
        await tx.query("DELETE FROM orbit_oauth_states WHERE hash=$1", [
          hash(state),
        ]);
      });
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: config.githubClientId,
            client_secret: config.githubClientSecret,
            code,
            redirect_uri: config.origin + "/api/v1/auth/github/callback",
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const token = (await response.json()) as { access_token?: string };
      if (!response.ok || !token.access_token)
        throw new DomainError(401, "GitHub sign-in failed");
      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: "Bearer " + token.access_token,
          Accept: "application/vnd.github+json",
          "User-Agent": "Orbit",
        },
        signal: AbortSignal.timeout(15000),
      });
      const user = (await userResponse.json()) as {
        id: number;
        login: string;
        avatar_url: string;
      };
      if (!userResponse.ok || !user.id)
        throw new DomainError(401, "Cannot read GitHub identity");
      const userId = "usr_github_" + user.id;
      await db.query(
        "INSERT INTO orbit_accounts (id,login,avatar_url) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET login=excluded.login,avatar_url=excluded.avatar_url",
        [userId, user.login, user.avatar_url],
      );
      reply
        .clearCookie("orbit_oauth", cookie)
        .setCookie("orbit_session", await issue(userId, "web", "Browser"), {
          ...cookie,
          maxAge: 604800,
        });
      const destination = new URL(
        req.cookies.orbit_return ?? "/workspace",
        config.origin,
      );
      reply.clearCookie("orbit_return", cookie);
      return reply.redirect(
        destination.origin === config.origin &&
          ["/", "/workspace", "/projects", "/device", "/onboarding"].includes(destination.pathname)
          ? destination.pathname + destination.search
          : "/projects",
      );
    },
  );
  await registerEmail(
    app,
    db,
    config.origin,
    account,
    (id) => issue(id, "web", "Browser"),
    config.sendEmail,
  );
  app.get("/api/v1/me", (req) => account(req));
  app.post("/api/v1/auth/logout", async (req, reply) => {
    await account(req);
    const token =
      req.headers.authorization?.slice(7) ?? req.cookies.orbit_session;
    if (token)
      await db.query("DELETE FROM orbit_credentials WHERE hash=$1", [
        hash(token),
      ]);
    reply.clearCookie("orbit_session", cookie);
    return { ok: true };
  });
  app.post(
    "/api/v1/auth/device/start",
    {
      schema: {
        body: Type.Object(
          { name: Type.String({ minLength: 1, maxLength: 100 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      const deviceCode = secret(),
        code = randomBytes(5).toString("hex").toUpperCase();
      await db.query(
        "INSERT INTO orbit_device_codes (hash,code,name,user_id,expires_at) VALUES ($1,$2,$3,$4,$5)",
        [
          hash(deviceCode),
          code,
          (req.body as { name: string }).name,
          null,
          time(600),
        ],
      );
      return {
        deviceCode,
        code,
        verificationUrl: config.origin + "/device?code=" + code,
        interval: 3,
        expiresIn: 600,
      };
    },
  );
  app.post(
    "/api/v1/auth/device/approve",
    {
      schema: {
        body: Type.Object(
          { code: Type.String({ pattern: "^[A-F0-9]{10}$" }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      const user = await account(req);
      const code = (req.body as { code: string }).code;
      await db.transaction(async (tx) => {
        const rows = await tx.query(
          "SELECT hash FROM orbit_device_codes WHERE code=$1 AND expires_at>$2 AND user_id IS NULL",
          [code, time(0)],
        );
        if (!rows.length)
          throw new DomainError(404, "Code expired or already approved");
        await tx.query(
          "UPDATE orbit_device_codes SET user_id=$1 WHERE code=$2",
          [user.id, code],
        );
      });
      return { ok: true };
    },
  );
  app.post(
    "/api/v1/auth/device/token",
    {
      schema: {
        body: Type.Object(
          { deviceCode: Type.String({ minLength: 20, maxLength: 200 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req, reply) => {
      return db.transaction(async (tx) => {
        const h = hash((req.body as { deviceCode: string }).deviceCode);
        const rows = await tx.query<{ user_id: string | null; name: string }>(
          "SELECT user_id,name FROM orbit_device_codes WHERE hash=$1 AND expires_at>$2",
          [h, time(0)],
        );
        const row = rows[0];
        if (!row) throw new DomainError(400, "Device code expired");
        if (!row.user_id) return reply.code(202).send({ pending: true });
        const token = secret(),
          now = time(0);
        await tx.query(
          "INSERT INTO orbit_credentials (hash,user_id,kind,device_id,name,created_at,expires_at,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            hash(token),
            row.user_id,
            "cli",
            "dev_" + randomUUID(),
            row.name,
            now,
            time(2592000),
            now,
          ],
        );
        await tx.query("DELETE FROM orbit_device_codes WHERE hash=$1", [h]);
        return { token, expiresAt: time(2592000) };
      });
    },
  );
  app.get("/api/v1/devices", async (req) => {
    const user = await account(req);
    const rows = await db.query<{
      device_id: string;
      name: string;
      created_at: string;
      last_seen_at: string;
    }>(
      "SELECT device_id,name,created_at,last_seen_at FROM orbit_credentials WHERE user_id=$1 AND kind=$2 AND expires_at>$3",
      [user.id, "cli", time(0)],
    );
    return {
      items: rows.map((r) => ({
        id: r.device_id,
        name: r.name,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      })),
      nextCursor: null,
    };
  });
  app.delete("/api/v1/devices/:id", async (req) => {
    const user = await account(req);
    await db.query(
      "DELETE FROM orbit_credentials WHERE user_id=$1 AND device_id=$2",
      [user.id, (req.params as { id: string }).id],
    );
    return { ok: true };
  });
  return account;
}
