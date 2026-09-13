import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepository, gitText } from "@orbit/git-store";
import { credentials, cloud, serverUrl } from "./config.js";
import type { Project, Session, SessionSummary, UniversalEvent, Workstream } from "@orbit/contracts";

async function putChanged(repo: GitRepository, pid: string, kind: "project" | "workstream" | "session" | "event" | "summary", value: any) {
  const prior = await repo.get(pid, kind, value.id);
  if (JSON.stringify(prior) !== JSON.stringify(value)) await repo.put(pid, kind, value);
}

export async function buildPublishProjection(source: GitRepository) {
  const root = join(source.root, ".orbit", "publish");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = await GitRepository.open(root, true);
  const project = await source.get<Project>((await source.state("project:id")) ?? "", "project", (await source.state("project:id")) ?? "").catch(() => null)
    ?? (await source.db.query<{ data: string }>("SELECT data FROM orbit_entities WHERE kind=$1 LIMIT 1", ["project"])).map((row) => JSON.parse(row.data) as Project)[0];
  if (!project) {
    await target.db.close();
    throw new Error("Project history is missing");
  }
  const pid = project.id;
  const selected = new Set<string>(JSON.parse((await source.state("publish:selected:sessions")) ?? "[]"));
  await putChanged(target, pid, "project", project);
  const sourceSessions = (await source.list<Session>(pid, "session")).filter((session) => selected.has(session.id));
  const keepSessions = new Set(sourceSessions.map((session) => session.id));
  for (const session of await target.list<Session>(pid, "session"))
    if (!keepSessions.has(session.id)) await target.remove(pid, "session", session.id);
  const workstreamIds = new Set(sourceSessions.map((session) => session.workstreamId));
  for (const workstream of await source.list<Workstream>(pid, "workstream"))
    if (workstreamIds.has(workstream.id)) await putChanged(target, pid, "workstream", workstream);
  for (const session of sourceSessions) {
    await putChanged(target, pid, "session", session);
    for (const event of await source.list<UniversalEvent>(pid, "event", session.id))
      await putChanged(target, pid, "event", event);
    for (const summary of await source.list<SessionSummary>(pid, "summary", session.id))
      await putChanged(target, pid, "summary", summary);
  }
  for (const workstream of await target.list<Workstream>(pid, "workstream"))
    if (!workstreamIds.has(workstream.id)) await target.remove(pid, "workstream", workstream.id);
  await target.checkpoint("Publish selected Orbit conversations");
  return target;
}
export async function gitCredentials(
  repo: GitRepository,
  remote = "origin",
): Promise<NodeJS.ProcessEnv> {
  const c = await credentials();
  if (!c) return {};
  const url = await gitText(repo.history, ["remote", "get-url", remote]).catch(
    () => "",
  );
  if (!url.startsWith(c.server + "/git/")) return {};
  const helper = join(repo.local, "askpass.cjs");
  await writeFile(
    helper,
    '#!/usr/bin/env node\nprocess.stdout.write((process.argv[2]||"").toLowerCase().includes("username")?"orbit":process.env.ORBIT_GIT_TOKEN||"");\n',
    { mode: 0o700 },
  );
  await chmod(helper, 0o700);
  return { GIT_ASKPASS: helper, ORBIT_GIT_TOKEN: c.token };
}
export async function enablePublishing(repo: GitRepository, project: Project) {
  const selected = (await repo.state("publish:mode")) === "selected-v1";
  const target = selected ? await buildPublishProjection(repo) : repo;
  let remote = await gitText(target.history, [
    "remote",
    "get-url",
    "origin",
  ]).catch(() => null);
  if (!remote) {
    await cloud("/projects", {
      id: project.id,
      name: project.name,
      description: project.description,
      repository: project.repository,
    });
    remote = serverUrl() + "/git/" + project.id + ".git";
    await target.remote("origin", remote);
  }
  await repo.setState("publish:enabled", "true");
  if (target !== repo) await target.db.close();
}
export class PublishWorker {
  constructor(readonly repo: GitRepository) {}
  async flush(signal?: AbortSignal, force = false) {
    if (signal?.aborted) return;
    if (!force && (await this.repo.state("publish:enabled")) !== "true") return;
    const target = (await this.repo.state("publish:mode")) === "selected-v1"
      ? await buildPublishProjection(this.repo)
      : this.repo;
    try {
      await target.push("origin", await gitCredentials(target), signal ? 3000 : 30000);
    } finally {
      if (target !== this.repo) await target.db.close();
    }
  }
  async run(signal: AbortSignal, onError: (e: unknown) => void) {
    let delay = 5000,
      last = "";
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, delay);
        signal.addEventListener("abort", done, { once: true });
      });
      if (signal.aborted) break;
      try {
        const current = JSON.stringify(await this.repo.branches());
        if (
          current !== last &&
          (await this.repo.state("publish:enabled")) === "true"
        ) {
          await this.flush();
          last = current;
        }
        delay = 5000;
      } catch (e) {
        onError(e);
        delay = Math.min(delay * 2, 60000);
      }
    }
  }
}
