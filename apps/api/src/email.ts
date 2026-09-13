import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { DomainError, type SqlDatabase } from "@orbit/local-store";
import type { Account } from "@orbit/contracts";
import { isAllowedBrowserOrigin } from "./origin.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function registerEmail(
  app: FastifyInstance,
  db: SqlDatabase,
  origin: string,
  account: (req: FastifyRequest) => Promise<Account>,
  issue: (id: string) => Promise<string>,
  send?: (email: string, url: string) => Promise<void>,
) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS orbit_email_accounts (email TEXT PRIMARY KEY,user_id TEXT NOT NULL)",
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS orbit_email_tokens (hash TEXT PRIMARY KEY,email TEXT NOT NULL,user_id TEXT,expires_at TEXT NOT NULL)",
  );
  const cookie = {
    path: "/",
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax" as const,
  };
  app.post(
    "/api/v1/auth/email/request",
    { config: { rateLimit: { max: 5, timeWindow: 60000 } } },
    async (req, reply) => {
      if (!isAllowedBrowserOrigin(req.headers.origin, origin))
        throw new DomainError(403, "Request origin is not allowed");
      const browserOrigin = req.headers.origin ?? origin;
      const body = req.body as { email?: unknown; linkAccount?: boolean; next?: unknown };
      if (
        typeof body?.email !== "string" ||
        body.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
      )
        throw new DomainError(400, "Enter a valid email address");
      const email = body.email.trim().toLowerCase(),
        token = randomBytes(32).toString("base64url");
      const user = body.linkAccount ? await account(req) : null;
      const existing = await db.query<{ user_id: string }>(
        "SELECT user_id FROM orbit_email_accounts WHERE email=$1",
        [email],
      );
      if (user && existing[0] && existing[0].user_id !== user.id)
        throw new DomainError(
          409,
          "Email is already associated with another account",
        );
      // Delivery is injectable for tests; production uses SMTP. Never return or log the token.
      await db.query(
        "INSERT INTO orbit_email_tokens (hash,email,user_id,expires_at) VALUES ($1,$2,$3,$4)",
        [
          hash(token),
          email,
          user?.id ?? null,
          new Date(Date.now() + 900000).toISOString(),
        ],
      );
      let next = "/";
      if (typeof body.next === "string" && body.next.length <= 2048) {
        try {
          const destination = new URL(body.next, origin);
          if (destination.origin === origin && body.next.startsWith("/") && !body.next.startsWith("//") && !body.next.includes("\\"))
            next = destination.pathname + destination.search;
        } catch { /* An invalid return path falls back to the workspace. */ }
      }
      const url = browserOrigin + "/login?token=" + encodeURIComponent(token) + "&next=" + encodeURIComponent(next);
      try {
        if (send) await send(email, url);
        else {
          if (!process.env.ORBIT_SMTP_URL || !process.env.ORBIT_MAIL_FROM)
            throw new Error("Email delivery is not configured");
          const nodemailer = await import("nodemailer");
          await nodemailer.default
            .createTransport(process.env.ORBIT_SMTP_URL)
            .sendMail({
              from: process.env.ORBIT_MAIL_FROM,
              to: email,
              subject: "Sign in to Orbit",
              text:
                "Confirm your Orbit sign-in:\n\n" +
                url +
                "\n\nThis link expires in 15 minutes.",
            });
        }
      } catch (e) {
        await db.query("DELETE FROM orbit_email_tokens WHERE hash=$1", [
          hash(token),
        ]);
        throw new DomainError(
          503,
          "Email delivery is unavailable. Please try again later.",
        );
      }
      return reply
        .code(202)
        .send({ message: "Check your email for a sign-in link." });
    },
  );
  app.post("/api/v1/auth/email/confirm", async (req, reply) => {
    if (!isAllowedBrowserOrigin(req.headers.origin, origin))
      throw new DomainError(403, "Request origin is not allowed");
    const token = (req.body as { token?: unknown })?.token;
    if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(token))
      throw new DomainError(400, "Invalid sign-in link");
    const userId = await db.transaction(async (tx) => {
      const rows = await tx.query<{ email: string; user_id: string | null }>(
        "SELECT email,user_id FROM orbit_email_tokens WHERE hash=$1 AND expires_at>$2",
        [hash(token), new Date().toISOString()],
      );
      const row = rows[0];
      if (!row)
        throw new DomainError(401, "Sign-in link expired or already used");
      if (row.user_id) {
        const user = await account(req);
        if (user.id !== row.user_id)
          throw new DomainError(
            403,
            "Sign in to the original account to link this email",
          );
      }
      let existing = (
        await tx.query<{ user_id: string }>(
          "SELECT user_id FROM orbit_email_accounts WHERE email=$1",
          [row.email],
        )
      )[0]?.user_id;
      if (row.user_id && existing && existing !== row.user_id)
        throw new DomainError(409, "Email belongs to another account");
      const id =
        existing ??
        row.user_id ??
        "usr_email_" + randomBytes(16).toString("hex");
      await tx.query(
        "INSERT INTO orbit_accounts (id,login,avatar_url) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
        [id, row.email, null],
      );
      await tx.query(
        "INSERT INTO orbit_email_accounts (email,user_id) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING",
        [row.email, id],
      );
      await tx.query("DELETE FROM orbit_email_tokens WHERE hash=$1", [
        hash(token),
      ]);
      return id;
    });
    reply.setCookie("orbit_session", await issue(userId), {
      ...cookie,
      maxAge: 604800,
    });
    return { ok: true };
  });
}
