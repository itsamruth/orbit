import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
export interface Credentials {
  server: string;
  token: string;
  expiresAt: string;
}
const directory = () =>
  process.env.ORBIT_CONFIG_DIR ?? join(homedir(), ".config", "orbit");
export function serverUrl() {
  const url = new URL(process.env.ORBIT_SERVER_URL ?? "http://127.0.0.1:4318");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("ORBIT_SERVER_URL must be a plain HTTP(S) origin");
  if (
    url.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Remote Orbit servers require HTTPS");
  return url.origin;
}
export async function credentials(): Promise<Credentials | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(directory(), "credentials.json"), "utf8"),
    ) as Credentials;
    if (parsed.server !== serverUrl()) return null;
    if (!parsed.token || typeof parsed.expiresAt !== "string")
      throw new Error("Invalid Orbit credentials");
    return parsed;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function cloud<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  auth = true,
): Promise<T> {
  const creds = auth ? await credentials() : null;
  if (auth && !creds)
    throw new Error("Run orbit auth login to connect this device.");
  const response = await fetch(serverUrl() + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(creds ? { Authorization: "Bearer " + creds.token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json()) as { message?: string };
  if (!response.ok)
    throw new Error(
      data.message ?? "Cloud request failed (" + response.status + ")",
    );
  return data as T;
}
export async function auth(command: string) {
  if (command === "status") {
    const c = await credentials();
    console.log(
      c
        ? JSON.stringify(await cloud("/me"), null, 2)
        : "Not signed in. Run orbit auth login.",
    );
    return;
  }
  if (command === "logout") {
    const c = await credentials();
    if (c) await cloud("/auth/logout", {}, "POST");
    try {
      await unlink(join(directory(), "credentials.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    console.log("Signed out.");
    return;
  }
  if (command !== "login")
    throw new Error("Usage: orbit auth login | logout | status");
  const start = await cloud<{
    deviceCode: string;
    code: string;
    verificationUrl: string;
    interval: number;
    expiresIn: number;
  }>("/auth/device/start", { name: hostname() }, "POST", false);
  console.log(
    "Open " + start.verificationUrl + "\nApprove code: " + start.code,
  );
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, start.interval * 1000));
    const result = await cloud<{
      pending?: boolean;
      token?: string;
      expiresAt?: string;
    }>("/auth/device/token", { deviceCode: start.deviceCode }, "POST", false);
    if (!result.token) continue;
    await mkdir(directory(), { recursive: true, mode: 0o700 });
    await chmod(directory(), 0o700);
    await writeFile(
      join(directory(), "credentials.json"),
      JSON.stringify({
        server: serverUrl(),
        token: result.token,
        expiresAt: result.expiresAt,
      }) + "\n",
      { mode: 0o600 },
    );
    await chmod(join(directory(), "credentials.json"), 0o600);
    console.log("Device connected to Orbit.");
    return;
  }
  throw new Error("Device authorization expired. Run orbit auth login again.");
}
