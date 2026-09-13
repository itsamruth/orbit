import { captureNativeBatch } from "../adapters/shared/capture.js";
import { bootstrapText, digest } from "../adapters/shared/normalize.js";
import { assembleEvents, readConversation } from "./conversation.js";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { claudeAdapter } from "../adapters/claude/index.js";
import { codexAdapter } from "../adapters/codex/index.js";
import {
  readRecords,
  type AgentAdapter,
  type NativeSession,
} from "../adapters/shared/index.js";
import { inspectWorkspace } from "../project/index.js";
import type {
  Project,
  Session,
  UniversalEvent,
  Workstream,
} from "../protocol/index.js";
import { PublishWorker } from "../publishing/worker.js";
import { PolicyFilter, defaultPolicy } from "../security/index.js";
import { GitRepository as Repository } from "../storage/git/index.js";
import { buildContextBundle, workspaceWarnings, type PreparedContext } from "./handoff/index.js";
export const adapters: Record<string, AgentAdapter> = {
  codex: codexAdapter,
  claude: claudeAdapter,
};
export async function confirm(message: string) {
  if (!process.stdin.isTTY)
    throw new Error(message + " Run interactively to acknowledge.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if ((await rl.question(message + " [y/N] ")).toLowerCase() !== "y")
      throw new Error("Cancelled");
  } finally {
    rl.close();
  }
}
export async function syncWorker(
  repo: Repository,
  _projectId: string,
): Promise<PublishWorker | null> {
  return new PublishWorker(repo);
}
export async function choose(
  repo: Repository,
  projectId: string,
  root: string,
  explicit?: string,
): Promise<Workstream | null> {
  const all = await repo.list<Workstream>(projectId, "workstream");
  if (explicit) {
    const w = all.find((w) => w.id === explicit);
    if (!w) throw new Error("Workstream does not belong to this project");
    return w;
  }
  const active = await repo.state("active:" + projectId);
  const chosen = all.find((w) => w.id === active);
  if (chosen) return chosen;
  const activeSessions = await repo.list<Session>(projectId, "session");
  const candidates = [
    ...new Set(
      activeSessions
        .filter((s) => s.status === "active")
        .map((s) => s.workstreamId),
    ),
  ];
  if (candidates.length > 1) {
    if (!process.stdin.isTTY)
      throw new Error(
        "Multiple active workstreams; use orbit continue <id> --agent <agent>",
      );
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      console.log(
        candidates
          .map(
            (id, i) =>
              i + 1 + ". " + (all.find((w) => w.id === id)?.title ?? id),
          )
          .join("\n"),
      );
      const index =
        Number(await rl.question("Choose a workstream number: ")) - 1;
      const selected = all.find((w) => w.id === candidates[index]);
      if (!selected) throw new Error("Invalid workstream selection");
      return selected;
    } finally {
      rl.close();
    }
  }
  const workspace = await inspectWorkspace(root);
  const same = all.filter((w) => w.branch === workspace.branch);
  return same.at(-1) ?? all.at(-1) ?? null;
}
export async function newWorkstream(
  repo: Repository,
  pid: string,
  root: string,
  title: string,
) {
  const now = new Date().toISOString();
  const w: Workstream = {
    id: "work_" + randomUUID(),
    projectId: pid,
    title,
    titleSource: title === "Untitled workstream" ? "automatic" : "manual",
    branch: (await inspectWorkspace(root)).branch,
    createdAt: now,
    updatedAt: now,
  };
  await repo.put(pid, "workstream", w);
  await repo.setState("active:" + pid, w.id);
  return w;
}
export async function continueContext(repo: Repository, pid: string, w: Workstream, root: string, budget: number): Promise<PreparedContext> {
  const conversation = await readConversation(repo, pid, w.id);
  if (!conversation.events.some((e) => e.payload.type === "user_message" || e.payload.type === "assistant_message"))
    throw new Error("No captured conversation is available for this workstream. Start an agent normally before continuing.");
  const workspace = await inspectWorkspace(root);
  const previous = [...conversation.events].reverse().find((e) => e.payload.type === "git_state");
  if (previous?.payload.type === "git_state") {
    const warnings = workspaceWarnings(previous.payload.workspace, workspace);
    if (warnings.length) await confirm(warnings.join("\n") + " Continue in this workspace?");
  }
  const prepared = buildContextBundle(conversation, workspace, budget);
  const dir = join(root, ".orbit", "handoffs", prepared.bundle.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(prepared.bundle) + "\n", { mode: 0o600 });
  await writeFile(join(dir, "context.md"), prepared.context + "\n", { mode: 0o600 });
  if (prepared.bundle.omittedEventIds.length) console.error("Orbit: " + prepared.bundle.omittedEventIds.length + " events are outside the prompt budget. Full captured history remains available through orbit context.");
  return prepared;
}
type Owner = {
  socket: string;
  token: string;
  sessionId: string;
  workstreamId: string;
};
export async function requestStop(root: string): Promise<void> {
  let owner: Owner;
  try {
    owner = JSON.parse(
      await readFile(join(root, ".orbit", "process.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(owner.socket);
    let body = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          "Could not stop the active agent. Exit it in its terminal and retry.",
        ),
      );
    }, 15000);
    socket.on("connect", () =>
      socket.end(
        JSON.stringify({ token: owner.token, command: "stop" }) + "\n",
      ),
    );
    socket.on("data", (data) => {
      body += data.toString();
    });
    socket.on("end", () => {
      clearTimeout(timer);
      if (body.trim() === "stopped") resolve();
      else reject(new Error("The active agent did not confirm a clean stop."));
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          "Cannot contact the Orbit-owned agent: " +
            e.message +
            ". Run orbit recover after verifying the old process has exited.",
        ),
      );
    });
  });
}
export async function runAgent(
  repo: Repository,
  pid: string,
  root: string,
  w: Workstream,
  agent: AgentAdapter,
  context?: PreparedContext,
) {
  const dir = join(root, ".orbit");
  const ownerPath = join(dir, "process.json");
  const nativeId = randomUUID(),
    sessionId = "sess_" + randomUUID(),
    marker = randomUUID(),
    now = new Date().toISOString();
  let session: Session = {
    id: sessionId,
    projectId: pid,
    workstreamId: w.id,
    agent: agent.id,
    nativeSessionId: agent.id === "claude" ? nativeId : "pending_" + marker,
    status: "active",
    startedAt: now,
    endedAt: null,
    captureMode: "live",
    normalizerVersion: 2,
    bootstrapHash: digest(bootstrapText(marker, context?.context)),
    ...(context?.bundle.previousSessionId ? { continuation: { sessionId: context.bundle.previousSessionId, throughEventId: context.bundle.throughEventId, handoffId: context.bundle.id } } : {}),
  };
  const origin = await repo.state("continue:origin");
  if (origin) {
    session.origin = JSON.parse(origin);
    await repo.setState("continue:origin", "");
  }
  const socketPath = join(
    tmpdir(),
    "orbit-" + randomBytes(12).toString("hex") + ".sock",
  );
  const token = randomBytes(32).toString("hex");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      ownerPath,
      JSON.stringify({
        socket: socketPath,
        token,
        sessionId,
        workstreamId: w.id,
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "An Orbit agent already owns this checkout. Use orbit switch, or exit the active agent first.",
      );
    throw e;
  }
  try {
    await repo.put(pid, "session", session);
    await repo.setState("active:" + pid, w.id);
  } catch (error) {
    await unlink(ownerPath).catch(() => {});
    throw error;
  }
  const filter = new PolicyFilter();
  let native: NativeSession | null = null;
  let sequence = 0;
  let capturing: Promise<void> | null = null;
  let captureFailed = false;
  let lastCheckpoint = Date.now();
  async function append(payload: UniversalEvent["payload"]) {
    const e: UniversalEvent = {
      schemaVersion: 2,
      source: { adapter: "orbit", normalizerVersion: 2, nativeVersion: "1", recordId: "runtime:" + sequence, offset: 0, blockIndex: 0 },
      id: "evt_" + randomUUID(),
      projectId: pid,
      workstreamId: w.id,
      sessionId,
      sequence: sequence++,
      occurredAt: new Date().toISOString(),
      payload,
    };
    const project = await repo.get<Project>(pid, "project", pid);
    if (!project) throw new Error("Project history was deleted");
    const result = filter.apply(e, {
      ...defaultPolicy,
      excludedPaths: project.excludedPaths,
    });
    if (result.action === "keep") await repo.put(pid, "event", result.event);
  }
  async function tick() {
    if (capturing) return capturing;
    capturing = (async () => {
      if (!native) {
        const matches = await agent.discover(
          root,
          agent.id === "claude"
            ? { nativeId }
            : { marker, since: Date.parse(now) - 1000 },
        );
        if (matches.length > 1)
          throw new Error(
            "More than one native session matched the launch marker",
          );
        native = matches[0] ?? null;
        if (!native) return;
        session = { ...session, nativeSessionId: native.id };
        await repo.put(pid, "session", session);
        await repo.setState("native:" + sessionId, JSON.stringify(native));
      }
      const { readRecords } = await import("../adapters/shared/index.js");
      const offset = await repo.offset(native.path);
      const batch = await readRecords(native.path, offset);
      if (batch.malformed) captureFailed = true;
      if (batch.malformed)
        console.error(
          "Orbit: skipped " +
            batch.malformed +
            " malformed native records; capture is incomplete.",
        );
      const project = await repo.get<Project>(pid, "project", pid);
      if (!project) throw new Error("Project history was deleted");
      const captured = await captureNativeBatch(repo, agent, session, native, batch, sequence, { ...defaultPolicy, excludedPaths: project.excludedPaths });
      const kept = captured.events;
      sequence = captured.nextSequence;
      const objective = assembleEvents(kept).find((e) => e.payload.type === "user_message");
      if (kept.length) {
        w = {
          ...w,
          title:
            w.title === "Untitled workstream" &&
            objective?.payload.type === "user_message"
              ? objective.payload.text.replace(/\s+/g, " ").slice(0, 120)
              : w.title,
          updatedAt: new Date().toISOString(),
        };
        await repo.put(pid, "workstream", w);
      }
      const completed = batch.records.some((r) =>
        agent.isTurnComplete?.(r.value),
      );
      if (completed || Date.now() - lastCheckpoint >= 30000) {
        await repo.checkpoint(
          completed
            ? "Completed conversation turn"
            : "Partial conversation checkpoint",
        );
        lastCheckpoint = Date.now();
      }
    })().finally(() => {
      capturing = null;
    });
    return capturing;
  }
  const worker = await syncWorker(repo, pid);
  const controller = new AbortController();
  let syncErrorShown = false;
  const syncing = worker?.run(controller.signal, (e) => {
    if (!syncErrorShown) {
      console.error(
        "Orbit: cloud unavailable; keeping history locally. " + String(e),
      );
      syncErrorShown = true;
    }
  });
  await append({ type: "git_state", workspace: await inspectWorkspace(root) });
  let child: ReturnType<typeof spawn> | undefined;
  let stopped = false;
  let stopping = false;
  let stopReply: ((text: string) => void) | null = null;
  const ipc = createServer({ allowHalfOpen: true }, (socket) => {
    let body = "";
    socket.setTimeout(2000, () => socket.destroy());
    socket.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2048) socket.destroy();
    });
    socket.on("end", () => {
      try {
        const message = JSON.parse(body);
        if (
          typeof message.token !== "string" ||
          message.token.length !== token.length ||
          !timingSafeEqual(Buffer.from(message.token), Buffer.from(token)) ||
          message.command !== "stop"
        ) {
          socket.end("denied");
          return;
        }
        if (stopping) {
          socket.end("busy");
          return;
        }
        stopping = true;
        socket.setTimeout(14000, () => socket.destroy());
        stopReply = (text) => socket.end(text);
        if (child) child.kill("SIGTERM");
        else socket.end("failed");
      } catch {
        socket.end("denied");
      }
    });
  });
  const onSignal = () => {
    child?.kill("SIGTERM");
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      ipc.once("error", reject);
      ipc.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
    console.error(
      "Orbit: capturing " +
        agent.id +
        " in " +
        w.title +
        ". Publishing " +
        ((await repo.state("publish:enabled")) === "true"
          ? "enabled"
          : "disabled") +
        ".",
    );
    child = spawn(
      agent.id,
      agent.launchArgs({
        nativeId,
        marker,
        args: [],
        ...(context ? { context: context.context } : {}),
      }),
      { cwd: root, stdio: "inherit", shell: false },
    );
    timer = setInterval(() => {
      void tick().catch((e) => {
        captureFailed = true;
        console.error(
          "Orbit capture error: " +
            (e instanceof Error ? e.message : String(e)),
        );
        if (timer) clearInterval(timer);
      });
    }, 750);
    const timeout = setTimeout(() => {
      if (!native) {
        captureFailed = true;
        console.error(
          "Orbit: no matching JSONL transcript found. This native storage format may be unsupported; the agent can continue, but capture is not confirmed.",
        );
      }
    }, 30000);
    let exitCode: number | null;
    try {
      exitCode = await new Promise<number | null>((resolve, reject) => {
        child!.once("error", reject);
        child!.once("exit", (code) => resolve(code));
      });
    } finally {
      clearTimeout(timeout);
    }
    if (timer) clearInterval(timer);
    await tick();
    if (native) {
      let before = -1;
      while (before !== (await repo.offset((native as NativeSession).path))) {
        before = await repo.offset((native as NativeSession).path);
        await tick();
      }
    }
    if (!native) {
      captureFailed = true;
      console.error(
        "Orbit: session exited without a captured native transcript.",
      );
    }
    await append({
      type: "git_state",
      workspace: await inspectWorkspace(root),
    });
    await append({
      type: "session_ended",
      reason: stopping ? "switched" : exitCode === 0 ? "exited" : "interrupted",
    });
    session = {
      ...session,
      status:
        captureFailed || (!stopping && exitCode !== 0)
          ? "interrupted"
          : "ended",
      endedAt: new Date().toISOString(),
    };
    await repo.put(pid, "session", session);
    await repo.put(pid, "workstream", {
      ...w,
      updatedAt: new Date().toISOString(),
    });
    await repo.checkpoint("Session " + session.status + ": " + w.title);
    if (session.status === "ended" && !stopping && !context) {
      try {
        const intelligence = await import("../intelligence/memory.js");
        const settings = await intelligence.getIntelligenceSettings(repo);
        if (settings.autoSummarize && settings.provider) {
          console.error(
            "Orbit: generating a private session summary with " +
              settings.provider +
              ".",
          );
          await intelligence.summarizeSession(repo, pid, session.id);
        }
      } catch (error) {
        console.error(
          "Orbit summary: " +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    stopped = true;
    if (captureFailed) process.exitCode = 1;
  } finally {
    if (timer) clearInterval(timer);
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    if (!stopped) {
      try {
        await repo.put(pid, "session", {
          ...session,
          status: "interrupted",
          endedAt: new Date().toISOString(),
        });
      } catch {}
    }
    await repo
      .checkpoint("Interrupted session checkpoint")
      .catch((e) => console.error("Orbit checkpoint failed: " + String(e)));
    controller.abort();
    await syncing;
    try {
      await worker?.flush(AbortSignal.timeout(3000));
    } catch (e) {
      console.error("Orbit: pending history will sync on the next connection.");
    }
    await unlink(ownerPath).catch(() => {});
    if (stopReply)
      (stopReply as (text: string) => void)(
        stopped && !captureFailed ? "stopped" : "failed",
      );
    await new Promise<void>((resolve) => ipc.close(() => resolve()));
    await unlink(socketPath).catch(() => {});
  }
}

export async function recoverCapture(repo: Repository, pid: string, session: Session) {
  const raw = await repo.state("native:" + session.id);
  if (!raw) return;
  const native = JSON.parse(raw) as NativeSession;
  const adapter = adapters[session.agent];
  if (!adapter) throw new Error("Unsupported recovery adapter");
  let sequence = (await repo.list<UniversalEvent>(pid, "event", session.id)).reduce((max, e) => Math.max(max, e.sequence + 1), 0);
  while (true) {
    const offset = await repo.offset(native.path);
    const batch = await readRecords(native.path, offset);
    if (batch.position === offset) break;
    const project = await repo.get<Project>(pid, "project", pid);
    if (!project) throw new Error("Project was deleted");
    const captured = await captureNativeBatch(repo, adapter, session, native, batch, sequence, { ...defaultPolicy, excludedPaths: project.excludedPaths });
    sequence = captured.nextSequence;
    if (batch.malformed) console.error("Orbit: malformed records were recorded as coverage gaps during recovery.");
  }
}
