import { spawn } from "node:child_process";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DomainError } from "@orbit/local-store";

export async function git(
  path: string,
  args: string[],
  options: {
    input?: string | Buffer;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    maxBytes?: number;
  } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    if (process.env.ORBIT_RECEIVE_VALIDATE === "1") {
      for (const key of [
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_QUARANTINE_PATH",
      ])
        if (process.env[key]) env[key] = process.env[key];
    }
    const child = spawn(
      "git",
      [
        "-C",
        path,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.ext.allow=never",
        ...args,
      ],
      {
        env: { ...env, GIT_TERMINAL_PROMPT: "0", ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );
    const out: Buffer[] = [],
      err: Buffer[] = [];
    let size = 0,
      failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error("Git operation timed out");
      child.kill("SIGKILL");
    }, options.timeout ?? 30000);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > (options.maxBytes ?? 128 * 1024 * 1024)) {
        failure = new Error("Git output exceeds supported size");
        child.kill("SIGKILL");
      } else out.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      if (Buffer.concat(err).length < 64000) err.push(b);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code)
        reject(
          new DomainError(
            409,
            Buffer.concat(err).toString().trim() || "Git operation failed",
          ),
        );
      else resolve(Buffer.concat(out));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  });
}
export const gitText = async (
  path: string,
  args: string[],
  options: Parameters<typeof git>[2] = {},
) => (await git(path, args, options)).toString("utf8").trim();
export async function head(path: string) {
  try {
    return await gitText(path, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    return null;
  }
}
export async function resolveRevision(path: string, revision = "HEAD") {
  if (
    !revision ||
    revision.startsWith("-") ||
    /[\x00-\x20]/.test(revision) ||
    revision.length > 256
  )
    throw new DomainError(400, "Invalid revision");
  return gitText(path, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    revision + "^{commit}",
  ]);
}
export async function branchName(path: string, name: string) {
  if (name.startsWith("-") || name === "HEAD")
    throw new DomainError(400, "Invalid branch name");
  await git(path, ["check-ref-format", "refs/heads/" + name]);
}
export async function atomicWrite(path: string, data: string) {
  const temp = path + ".tmp-" + process.pid;
  const f = await open(temp, "w", 0o600);
  try {
    await f.writeFile(data);
    await f.sync();
  } finally {
    await f.close();
  }
  const { rename } = await import("node:fs/promises");
  await rename(temp, path);
}
export async function withLock<T>(
  directory: string,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "writer.lock");
  const deadline = Date.now() + 15000;
  let handle;
  while (!handle) {
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(String(process.pid));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(await readFile(path, "utf8").catch(() => "0"));
      if (pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") {
            await unlink(path).catch(() => {});
            continue;
          }
        }
      }
      if (Date.now() > deadline)
        throw new DomainError(409, "Orbit repository is busy");
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(path);
  }
}
