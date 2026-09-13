import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveProject } from "../project/index.js";
import { registerProject } from "./registry.js";
import { startViewer, VIEWER_PORT, VIEWER_PROTOCOL } from "./server.js";

function configuredPort(
  value = process.env.ORBIT_VIEWER_PORT ?? String(VIEWER_PORT),
) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Viewer port must be between 1024 and 65535");
  return port;
}

async function running(port: number) {
  try {
    const response = await fetch(
      "http://127.0.0.1:" + port + "/api/v1/viewer/health",
      { signal: AbortSignal.timeout(1000) },
    );
    const body = (await response.json()) as { service?: string };
    if (response.ok && body.service === VIEWER_PROTOCOL) return true;
    throw new Error(
      "Another service is using port " +
        port +
        ". Use orbit dashboard --port <number>.",
    );
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === "TimeoutError")
    )
      return false;
    throw error;
  }
}

export async function ensureViewer(port = configuredPort()) {
  const url = "http://127.0.0.1:" + port;
  if (await running(port)) return url;
  const entry = process.argv[1];
  if (!entry) throw new Error("Unable to find the Orbit executable");
  try {
    await new Promise<void>((ready, reject) => {
      const child = spawn(
        process.execPath,
        [resolve(entry), "dashboard", "--foreground", "--port", String(port)],
        {
          detached: true,
          windowsHide: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: { ...process.env, ORBIT_VIEWER: "0" },
        },
      );
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(
          new Error(
            "Local dashboard did not start. Run orbit dashboard --foreground to see the error.",
          ),
        );
      }, 8000);
      let finished = false;
      function finish(error?: Error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (child.connected) child.disconnect();
        child.unref();
        if (error) reject(error);
        else ready();
      }
      child.once("error", (error) => finish(error));
      child.once("exit", (code) =>
        finish(
          new Error(
            "Local dashboard exited with code " +
              code +
              ". Run orbit dashboard --foreground for details.",
          ),
        ),
      );
      child.on("message", (message: { service?: string; error?: string }) => {
        if (message.service === VIEWER_PROTOCOL) finish();
        else if (message.error) finish(new Error(message.error));
      });
    });
  } catch (error) {
    // Another Orbit process may have won the race to start the same listener.
    if (!(await running(port))) throw error;
  }
  return url;
}

export async function attachViewer(root: string, projectId: string) {
  if (process.env.ORBIT_VIEWER === "0") return;
  try {
    await registerProject(root, projectId);
    await ensureViewer();
  } catch (error) {
    console.error(
      "Orbit: local history is saved; dashboard unavailable. " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

async function openBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((done) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.once("error", () => {
      console.log("Open the URL above in your browser.");
      done();
    });
    child.once("spawn", () => {
      child.unref();
      done();
    });
  });
}

export async function dashboardCommand(args: string[]) {
  let port = configuredPort(),
    foreground = false,
    stop = false,
    open = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) port = configuredPort(args[++i]);
    else if (args[i] === "--foreground") foreground = true;
    else if (args[i] === "--no-open") open = false;
    else if (args[i] === "--stop") stop = true;
    else
      throw new Error(
        "Usage: orbit dashboard [--port <number>] [--no-open] [--foreground | --stop]",
      );
  }
  if (stop && foreground)
    throw new Error("Choose either --stop or --foreground");
  const url = "http://127.0.0.1:" + port;
  if (stop) {
    if (!(await running(port))) {
      console.log("Local dashboard is not running.");
      return;
    }
    const response = await fetch(url + "/api/v1/viewer/stop", {
      method: "POST",
      headers: { Origin: url },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Unable to stop the local dashboard");
    console.log("Local dashboard stopped.");
    return;
  }
  if (foreground) {
    try {
      const server = await startViewer({ port });
      process.send?.({ service: VIEWER_PROTOCOL });
      console.log("Orbit local dashboard: " + url);
      const close = () => server.close();
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
      server.once("close", () => {
        process.removeListener("SIGINT", close);
        process.removeListener("SIGTERM", close);
      });
    } catch (error) {
      process.send?.({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }
  const current = await resolveProject(process.cwd());
  if (current) await registerProject(current.root, current.config.projectId);
  console.log("Orbit local dashboard: " + (await ensureViewer(port)));
  if (open) await openBrowser(url);
}
