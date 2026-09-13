import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { promisify } from "node:util";
import type { ProjectConfig, WorkspaceState } from "@orbit/core";
const exec = promisify(execFile);
async function git(cwd: string, args: string[]) {
  return (
    await exec("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  ).stdout;
}
async function gitRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch (error) {
    if (
      String((error as { stderr?: string }).stderr).includes(
        "not a git repository",
      )
    )
      return null;
    throw error;
  }
}
async function configAt(path: string): Promise<ProjectConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const config: unknown = JSON.parse(raw);
  if (
    !config ||
    typeof config !== "object" ||
    !("version" in config) ||
    config.version !== 1 ||
    !("projectId" in config) ||
    typeof config.projectId !== "string" ||
    !/^prj_[a-zA-Z0-9_-]+$/.test(config.projectId)
  )
    throw new Error("Invalid Orbit project configuration at " + path);
  return { version: 1, projectId: config.projectId };
}
async function readConfig(root: string) {
  const modern = await configAt(join(root, ".orbit", "project.json"));
  const legacy = await configAt(join(root, ".carry", "project.json"));
  if (modern && legacy && modern.projectId !== legacy.projectId)
    throw new Error(
      "Conflicting .orbit and .carry project identities; resolve explicitly before continuing.",
    );
  return modern ?? legacy;
}
export async function resolveProject(
  cwd: string,
): Promise<{ root: string; config: ProjectConfig } | null> {
  let current = await realpath(cwd);
  const boundary = await gitRoot(current);
  while (true) {
    const config = await readConfig(current);
    if (config) return { root: current, config };
    if (current === boundary || current === parse(current).root) return null;
    current = dirname(current);
  }
}
export async function initProject(
  cwd: string,
): Promise<{ root: string; config: ProjectConfig; created: boolean }> {
  const existing = await resolveProject(cwd);
  const root = existing?.root ?? (await gitRoot(cwd)) ?? (await realpath(cwd));
  const metadata = join(root, ".orbit");
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      join(metadata, ".gitignore"),
      "*\n!project.json\n!.gitignore\n",
      { flag: "wx" },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const config = existing?.config ?? {
    version: 1 as const,
    projectId: "prj_" + randomUUID(),
  };
  try {
    await writeFile(
      join(metadata, "project.json"),
      JSON.stringify(config, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const winner = await readConfig(root);
    if (!winner) throw new Error("Initialization failed; retry orbit init.");
    return { root, config: winner, created: false };
  }
  return { root, config, created: !existing };
}
export async function inspectWorkspace(root: string): Promise<WorkspaceState> {
  if (!(await gitRoot(root)))
    return { root, branch: null, head: null, porcelain: "", dirty: false };
  const [branch, head, porcelain] = await Promise.all([
    git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      .then((s) => s.trim())
      .catch(() => null),
    git(root, ["rev-parse", "--verify", "HEAD"])
      .then((s) => s.trim())
      .catch(() => null),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  return { root, branch, head, porcelain, dirty: porcelain.length > 0 };
}

export async function inspectRepository(root: string): Promise<string | null> {
  let raw: string;
  try {
    raw = (await git(root, ["remote", "get-url", "origin"])).trim();
  } catch {
    return null;
  }
  try {
    const u = new URL(raw);
    if (!["https:", "http:", "ssh:", "git:"].includes(u.protocol)) return null;
    return u.hostname + u.pathname.replace(/\.git$/, "");
  } catch {
    const ssh = /^[^@]+@([^:]+):(.+)$/.exec(raw);
    return ssh ? ssh[1] + "/" + ssh[2]!.replace(/\.git$/, "") : null;
  }
}
