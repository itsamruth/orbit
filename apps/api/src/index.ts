import { PostgresDatabase } from "./database.js";
import { SqliteDatabase } from "@orbit/local-store";
import { buildServer } from "./server.js";
const production = process.env.NODE_ENV === "production";
if (production && !process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required in production");
const db = process.env.DATABASE_URL
  ? new PostgresDatabase(process.env.DATABASE_URL)
  : new SqliteDatabase(
      process.env.ORBIT_API_DB ?? ".orbit-cloud/development.sqlite",
    );
if (db instanceof PostgresDatabase) await db.migrate();
const origin = process.env.ORBIT_ORIGIN ?? "http://127.0.0.1:5173";
if (production && !origin.startsWith("https://"))
  throw new Error("Production requires an HTTPS ORBIT_ORIGIN");
const devAuth = process.env.ORBIT_DEV_AUTH === "1";
const host = process.env.HOST ?? "127.0.0.1";
if (devAuth && host !== "127.0.0.1" && host !== "localhost")
  throw new Error("Development auth must bind to loopback");
const app = await buildServer(db, {
  origin,
  devAuth,
  ...(process.env.GITHUB_CLIENT_ID
    ? { githubClientId: process.env.GITHUB_CLIENT_ID }
    : {}),
  ...(process.env.GITHUB_CLIENT_SECRET
    ? { githubClientSecret: process.env.GITHUB_CLIENT_SECRET }
    : {}),
});
await app.listen({ port: Number(process.env.PORT ?? 4318), host });
console.log(
  "Orbit API listening on " +
    host +
    ":" +
    (process.env.PORT ?? 4318) +
    (devAuth ? " (explicit local development identity)" : ""),
);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await app.close();
  await db.close();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
