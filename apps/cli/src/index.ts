#!/usr/bin/env node
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  access,
  readFile,
  writeFile,
  unlink,
  mkdir,
  appendFile,
} from "node:fs/promises";
import {
  initProject,
  resolveProject,
  inspectRepository,
  inspectWorkspace,
} from "@orbit/project";
import {
  GitRepository,
  cloneRepository,
  compare,
  gitText,
} from "@orbit/git-store";
import { defaultPolicy } from "@orbit/security";
import { SqliteDatabase } from "@orbit/local-store";
import type { Project, Session, Workstream } from "@orbit/contracts";
import { auth, credentials, cloud } from "./config.js";
import { gitCredentials, enablePublishing, PublishWorker } from "./publish.js";
import { migrate } from "./migrate.js";
import { latestConversation } from "./switch.js";
import {
  adapters,
  choose,
  newWorkstream,
  continueContext,
  runAgent,
  recoverCapture,
  requestStop,
  confirm,
} from "./runtime.js";
const help = [
  "Orbit — Git for agent conversations",
  "orbit init                         Initialize local conversation Git history",
  "orbit codex | claude [--continue]   Launch and capture an agent",
  "orbit new [title]                   Create a workstream",
  "orbit continue <id> --agent <name> [--at <checkpoint>]",
  "orbit switch <codex|claude>        Continue the latest project conversation in that agent",
  "orbit commit -m <message>          Create a named checkpoint",
  "orbit log | history | status",
  "orbit diff <from> <to>",
  "orbit branch <name> [checkpoint]",
  "orbit checkout <branch>",
  "orbit remote add <name> <url>",
  "orbit push | fetch | pull [remote]",
  "orbit clone <url> <directory>",
  "orbit publish enable|disable       Opt in/out of automatic publishing",
  "orbit auth login|logout|status",
  "orbit serve                        Open the local conversation portal",
  "orbit import                       Preview and import native session history",
  "orbit providers                    Inspect local intelligence providers",
  "orbit intelligence configure --provider <codex|claude> [--auto on|off]",
  "orbit summarize <session-id> [--provider <codex|claude>] [--force]",
  "orbit recover                      Recover interrupted capture",
  "orbit migrate [--dry-run] [--from <export.json>] Import legacy history",
  "orbit export-legacy <project-id> <file> Download your legacy cloud export",
  "orbit session|workstream delete <id> Remove from current revision; older commits remain",
].join("\n");
async function ignoreSource(root: string) {
  try {
    const raw = await gitText(root, [
      "rev-parse",
      "--git-path",
      "info/exclude",
    ]);
    const file = resolve(root, raw);
    await mkdir(resolve(file, ".."), { recursive: true });
    const prior = await readFile(file, "utf8").catch(() => "");
    if (!prior.split("\n").includes("/.orbit/"))
      await appendFile(file, "\n/.orbit/\n");
  } catch (e) {
    if (!String(e).includes("not a git repository")) throw e;
  }
}
async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(help);
    return;
  }
  if (command === "auth") {
    await auth(args[0] ?? "status");
    return;
  }
  if (command === "sync" || command === "link")
    throw new Error(
      "Database sync was replaced by Git. Use orbit clone, orbit push, or orbit publish enable.",
    );
  if (command === "clone") {
    if (args.length !== 2)
      throw new Error("Usage: orbit clone <url> <directory>");
    const root = resolve(args[1]!);
    const c = await credentials();
    let env: NodeJS.ProcessEnv = {};
    if (c && args[0]!.startsWith(c.server + "/git/")) {
      const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const dir = await mkdtemp(join(tmpdir(), "orbit-auth-")),
        helper = join(dir, "askpass.cjs");
      await writeFile(
        helper,
        '#!/usr/bin/env node\nprocess.stdout.write((process.argv[2]||"").toLowerCase().includes("username")?"orbit":process.env.ORBIT_GIT_TOKEN||"")',
        { mode: 0o700 },
      );
      env = { GIT_ASKPASS: helper, ORBIT_GIT_TOKEN: c.token };
      try {
        const repo = await cloneRepository(args[0]!, root, env);
        await repo.db.close();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } else {
      const repo = await cloneRepository(args[0]!, root);
      await repo.db.close();
    }
    await ignoreSource(root);
    console.log(
      "Conversation history cloned to " +
        root +
        ". Source code and agent credentials are configured separately.",
    );
    return;
  }
  if (command === "export-legacy") {
    if (args.length !== 2 || !/^prj_[a-zA-Z0-9_-]+$/.test(args[0]!))
      throw new Error("Usage: orbit export-legacy <project-id> <file>");
    const data = await cloud("/legacy/projects/" + args[0] + "/export");
    await writeFile(resolve(args[1]!), JSON.stringify(data) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    return;
  }
  const fromIndex = args.indexOf("--from"),
    from = fromIndex >= 0 ? args[fromIndex + 1] : undefined;
  if (command === "migrate" && from && !(await resolveProject(process.cwd()))) {
    const data = JSON.parse(await readFile(resolve(from), "utf8"));
    if (
      data.format !== "orbit-legacy-export-v1" ||
      !/^prj_[a-zA-Z0-9_-]+$/.test(data.projectId)
    )
      throw new Error("Invalid export");
    if (args.includes("--dry-run")) {
      console.log(
        JSON.stringify(
          await migrate(process.cwd(), data.projectId, true, from),
          null,
          2,
        ),
      );
      return;
    }
    await mkdir(join(process.cwd(), ".orbit"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      join(process.cwd(), ".orbit", "project.json"),
      JSON.stringify({ version: 1, projectId: data.projectId }) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await ignoreSource(process.cwd());
  }
  const resolved =
    command === "init"
      ? await initProject(process.cwd())
      : await resolveProject(process.cwd());
  if (!resolved) throw new Error("Run orbit init first.");
  const { root, config } = resolved,
    pid = config.projectId;
  if (command === "migrate") {
    console.log(
      JSON.stringify(
        await migrate(root, pid, args.includes("--dry-run"), from),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "init") {
    if (args.length)
      throw new Error(
        "Usage: orbit init. Enable publishing separately with orbit publish enable.",
      );
    const legacy = await access(join(root, ".orbit", "history.sqlite")).then(
      () => true,
      () => false,
    );
    const modern = await access(join(root, ".orbit", "history", ".git")).then(
      () => true,
      () => false,
    );
    if (legacy && !modern)
      throw new Error(
        "Existing history detected. Run orbit migrate --dry-run, then orbit migrate.",
      );
    await ignoreSource(root);
  }
  const repo = await GitRepository.open(root, command === "init");
  try {
    let project = await repo.get<Project>(pid, "project", pid);
    if (!project) {
      if (command !== "init") throw new Error("Project manifest is missing");
      const now = new Date().toISOString();
      project = {
        id: pid,
        name: basename(root),
        description: "",
        repository: await inspectRepository(root),
        owner: "local",
        createdAt: now,
        updatedAt: now,
        cloudSyncEnabled: false,
        excludedPaths: defaultPolicy.excludedPaths,
      };
      await repo.put(pid, "project", project);
      await repo.setState("publish:mode", "selected-v1");
    }
    if (command === "init") {
      await repo.checkpoint("Initialize Orbit conversation history");
      console.log(
        "Orbit initialized at " +
          root +
          "\nProject: " +
          pid +
          "\nPublishing disabled",
      );
      return;
    }
    if (command === "status") {
      console.log(
        JSON.stringify(
          { ...(await repo.status()), workspace: await inspectWorkspace(root) },
          null,
          2,
        ),
      );
      return;
    }
    if (command === "import") {
      const memory = await import("@orbit/api");
      const agentIndex = args.indexOf("--agent");
      const only = agentIndex >= 0 && ["codex", "claude"].includes(args[agentIndex + 1] ?? "")
        ? (args[agentIndex + 1] as "codex" | "claude")
        : undefined;
      const candidates = await memory.listImportCandidates(repo, pid, root, only);
      if (args.includes("--list") || args.includes("--json")) {
        console.log(JSON.stringify({ items: candidates }, null, 2));
        return;
      }
      const explicit: string[] = [];
      for (let i = 0; i < args.length; i++) if (args[i] === "--session" && args[i + 1]) explicit.push(args[++i]!);
      let selected = args.includes("--all") ? candidates.filter((x) => x.importState !== "current" && x.importState !== "conflict").map((x) => x.id) : explicit;
      if (!selected.length) {
        for (const candidate of candidates.filter((x) => x.importState === "new" || x.importState === "updated")) {
          console.log(candidate.agent + "  " + (candidate.firstPrompt ?? candidate.nativeSessionId) + "  " + candidate.updatedAt);
          try {
            await confirm("Import this conversation?");
            selected.push(candidate.id);
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "Cancelled") throw error;
          }
        }
      }
      if (!selected.length) {
        console.log("No conversations selected.");
        return;
      }
      const result = await memory.importHistoricalSessions(repo, pid, root, selected, args.includes("--summarize"));
      console.log("Imported " + result.sessions.length + " conversation" + (result.sessions.length === 1 ? "" : "s") + ".");
      return;
    }
    if (command === "providers") {
      const { listProviders } = await import("@orbit/api");
      console.log(JSON.stringify({ items: await listProviders() }, null, 2));
      return;
    }
    if (command === "intelligence") {
      if (args[0] !== "configure") throw new Error("Usage: orbit intelligence configure --provider <codex|claude> [--auto on|off]");
      const providerIndex = args.indexOf("--provider");
      const provider = args[providerIndex + 1];
      if (!providerIndex || !["codex", "claude"].includes(provider ?? ""))
        throw new Error("Choose --provider codex or --provider claude");
      const autoIndex = args.indexOf("--auto");
      const auto = autoIndex < 0 ? true : args[autoIndex + 1] === "on";
      const { setIntelligenceSettings } = await import("@orbit/api");
      console.log(JSON.stringify(await setIntelligenceSettings(repo, { provider: provider as "codex" | "claude", autoSummarize: auto, maxInputBytes: 48000 }), null, 2));
      return;
    }
    if (command === "summarize") {
      if (!args[0]) throw new Error("Usage: orbit summarize <session-id> [--provider <codex|claude>] [--force]");
      const providerIndex = args.indexOf("--provider");
      const provider = providerIndex >= 0 ? args[providerIndex + 1] as "codex" | "claude" : undefined;
      if (provider && !["codex", "claude"].includes(provider)) throw new Error("Unsupported provider");
      const { summarizeSession } = await import("@orbit/api");
      const summary = await summarizeSession(repo, pid, args[0], provider, args.includes("--force"));
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (command === "commit") {
      if (args[0] !== "-m" || args.length !== 2)
        throw new Error("Usage: orbit commit -m <message>");
      console.log(await repo.checkpoint(args[1]!));
      return;
    }
    if (command === "log") {
      console.log(JSON.stringify(await repo.log(args[0] ?? "HEAD"), null, 2));
      return;
    }
    if (command === "diff") {
      if (args.length !== 2) throw new Error("Usage: orbit diff <from> <to>");
      console.log(
        JSON.stringify(
          await compare(repo.history, args[0]!, args[1]!),
          null,
          2,
        ),
      );
      return;
    }
    if (command === "branch") {
      if (!args[0]) {
        console.log(JSON.stringify(await repo.branches(), null, 2));
        return;
      }
      await repo.createBranch(args[0], args[1]);
      return;
    }
    if (command === "checkout") {
      if (args.length !== 1) throw new Error("Usage: orbit checkout <branch>");
      await repo.checkout(args[0]!);
      return;
    }
    if (command === "remote") {
      if (args[0] !== "add" || args.length !== 3)
        throw new Error("Usage: orbit remote add <name> <url>");
      await repo.remote(args[1]!, args[2]!);
      return;
    }
    if (["push", "fetch", "pull"].includes(command)) {
      if (command === "push" && (await repo.state("publish:mode")) === "selected-v1") {
        await new PublishWorker(repo).flush(undefined, true);
        console.log("push complete");
        return;
      }
      const remote = args[0] ?? "origin";
      await repo[command as "push" | "fetch" | "pull"](
        remote,
        await gitCredentials(repo, remote),
      );
      console.log(command + " complete");
      return;
    }
    if (command === "publish") {
      if (args[0] === "select" || args[0] === "unselect") {
        if (!args[1]) throw new Error("Usage: orbit publish " + args[0] + " <session-id>");
        const sessions = await repo.list<Session>(pid, "session");
        if (!sessions.some((session) => session.id === args[1])) throw new Error("Session does not belong to this project");
        const selected = new Set<string>(JSON.parse((await repo.state("publish:selected:sessions")) ?? "[]"));
        args[0] === "select" ? selected.add(args[1]) : selected.delete(args[1]);
        await repo.setState("publish:selected:sessions", JSON.stringify([...selected]));
        console.log(args[0] === "select" ? "Session selected for publishing." : "Session removed from future publication snapshots. Earlier Git commits retain published data.");
      } else if (args[0] === "preview") {
        const selected = new Set<string>(JSON.parse((await repo.state("publish:selected:sessions")) ?? "[]"));
        const sessions = (await repo.list<Session>(pid, "session")).filter((session) => selected.has(session.id));
        let events = 0;
        for (const session of sessions) events += (await repo.list(pid, "event", session.id)).length;
        console.log(JSON.stringify({ mode: await repo.state("publish:mode") ?? "legacy-full", sessions: sessions.map((session) => ({ id: session.id, agent: session.agent })), eventCount: events }, null, 2));
      } else if (args[0] === "enable") {
        await enablePublishing(repo, project);
        await new PublishWorker(repo).flush();
        console.log("Automatic publishing enabled for this checkout.");
      } else if (args[0] === "disable") {
        await repo.setState("publish:enabled", "false");
        console.log("Automatic publishing disabled.");
      } else throw new Error("Usage: orbit publish enable|disable|select|unselect|preview");
      return;
    }
    if (command === "serve") {
      const { buildServer } = await import("@orbit/api");
      const db = new SqliteDatabase(":memory:");
      const port = Number(process.env.ORBIT_PORT ?? 4318),
        origin = "http://127.0.0.1:" + port;
      const packagedWeb = join(dirname(fileURLToPath(import.meta.url)), "web");
      const webRoot = await access(packagedWeb).then(
        () => packagedWeb,
        () =>
          resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist"),
      );
      const app = await buildServer(db, {
        origin,
        devAuth: true,
        localRoot: root,
        webRoot,
      });
      await app.listen({ host: "127.0.0.1", port });
      console.log("Orbit portal: " + origin);
      const controller = new AbortController(),
        worker = new PublishWorker(repo);
      const running = worker.run(controller.signal, (e) =>
        console.error("Orbit publishing: " + String(e)),
      );
      await new Promise<void>((done) => {
        const stop = () => {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
          done();
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      });
      controller.abort();
      await running;
      await app.close();
      await db.close();
      return;
    }
    if (command === "new") {
      await repo.assertIdle();
      const w = await newWorkstream(
        repo,
        pid,
        root,
        args.join(" ") || "Untitled workstream",
      );
      await repo.checkpoint("New workstream: " + w.title);
      console.log(w.id + " " + w.title);
      return;
    }
    if (command === "history") {
      console.log("Conversation history (latest first)");
      const workstreams = (await repo.list<Workstream>(pid, "workstream"))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      for (const w of workstreams) {
        console.log(w.id + " " + w.title + "  " + w.updatedAt);
        const sessions = (await repo.list<Session>(pid, "session", w.id))
          .sort((a, b) => Date.parse(b.endedAt ?? b.startedAt) - Date.parse(a.endedAt ?? a.startedAt));
        for (const s of sessions)
          console.log("  " + s.id + " " + s.agent + " " + s.status + "  " + (s.endedAt ?? s.startedAt));
      }
      return;
    }
    if (["session", "workstream"].includes(command)) {
      if (args[0] !== "delete" || !args[1])
        throw new Error("Usage: orbit " + command + " delete <id>");
      await confirm(
        "Remove this " +
          command +
          " from the current branch? Earlier Git commits retain it.",
      );
      await repo.remove(pid, command as "session" | "workstream", args[1]);
      await repo.checkpoint("Remove " + command + " " + args[1]);
      return;
    }
    if (command === "recover") {
      await confirm(
        "Verify the old agent has exited. Recover its capture and release the checkout?",
      );
      for (const s of await repo.list<Session>(pid, "session"))
        if (s.status === "active") {
          await recoverCapture(repo, pid, s);
          await repo.put(pid, "session", {
            ...s,
            status: "interrupted",
            endedAt: new Date().toISOString(),
          });
        }
      await repo.checkpoint("Recover interrupted conversation");
      await unlink(join(root, ".orbit", "process.json")).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      console.log("Recovery complete");
      return;
    }
    let name = command,
      explicit: string | undefined,
      continuing = args.includes("--continue"),
      at: string | undefined;
    if (command === "continue") {
      explicit = args[0];
      if (
        !explicit ||
        args[1] !== "--agent" ||
        !args[2] ||
        ![3, 5].includes(args.length) ||
        (args.length === 5 && args[3] !== "--at")
      )
        throw new Error(
          "Usage: orbit continue <workstream> --agent <agent> [--at <checkpoint>]",
        );
      name = args[2];
      continuing = true;
      at = args[4];
    }
    if (command === "switch") {
      if (args.length !== 1) throw new Error("Usage: orbit switch <agent>");
      name = args[0]!;
      continuing = true;
    }
    const agent = adapters[name];
    if (!agent) throw new Error("Unknown command. Run orbit help.");
    const capabilities = await agent.probe();
    if (command === "switch") {
      await requestStop(root);
      await repo.exclusive(() => repo.refresh());
      await repo.assertIdle();
      const latest = await latestConversation(repo, pid, root);
      console.error(
        "\nLatest conversation: " + latest.workstream.title +
        "\nFrom: " + latest.session.agent + "  ->  " + name +
        "\nSession: " + latest.session.id +
        "\nLast activity: " + latest.updatedAt +
        "\nPreparing context for " + name + "...",
      );
      const context = await continueContext(repo, pid, latest.workstream, root, capabilities.maxContextBytes);
      console.error("Opening " + name + " with this conversation.\n");
      await runAgent(repo, pid, root, latest.workstream, agent, context);
      return;
    }
    await repo.assertIdle();
    let w = at ? null : await choose(repo, pid, root, explicit),
      context: string | undefined;
    if (at) {
      await repo.assertIdle();
      const branch = "continue/" + Date.now() + "-" + randomUUID().slice(0, 8);
      await repo.createBranch(branch, at);
      await repo.checkout(branch);
      w = await choose(repo, pid, root, explicit);
      await repo.setState(
        "continue:origin",
        JSON.stringify({
          checkpoint: await gitText(repo.history, ["rev-parse", "HEAD"]),
          workstreamId: explicit,
        }),
      );
    }
    if (w && !continuing && w.branch !== (await inspectWorkspace(root)).branch)
      w = null;
    if (!w) {
      if (continuing)
        throw new Error("No workstream is available at this revision");
      w = await newWorkstream(repo, pid, root, "Untitled workstream");
    }
    context = continuing
      ? await continueContext(repo, pid, w, root, capabilities.maxContextBytes)
      : undefined;
    await runAgent(repo, pid, root, w, agent, context);
  } finally {
    if (["new", "commit", "session", "workstream"].includes(command)) {
      try {
        await new PublishWorker(repo).flush(AbortSignal.timeout(3000));
      } catch (e) {
        console.error(
          "Orbit: checkpoint saved locally; publishing will retry. " +
            String(e),
        );
      }
    }
    await repo.db.close();
  }
}
main().catch((e) => {
  console.error("Orbit: " + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
