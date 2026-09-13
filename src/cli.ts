#!/usr/bin/env node
import { contextCommand } from "./commands/context-reader.js";
import { attachViewer, dashboardCommand } from "./viewer/service.js";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { auth, cloud, credentials, serverUrl } from "./auth/device.js";
import { historyCommand } from "./commands/history.js";
import { memoryCommand } from "./commands/memory.js";
import { publishCommand } from "./commands/publish.js";
import { sessionCommand } from "./commands/session.js";
import {
  initProject,
  inspectRepository,
  resolveProject,
} from "./project/index.js";
import type { Project, Session } from "./protocol/index.js";
import { PublishWorker } from "./publishing/worker.js";
import { defaultPolicy } from "./security/index.js";
import { confirm, newWorkstream, recoverCapture } from "./sessions/runtime.js";
import {
  cloneRepository,
  GitRepository,
  gitText,
} from "./storage/git/index.js";
import { migrate } from "./storage/migrate.js";
const help = [
  "Orbit - Git for AI agent conversations",
  "",
  "Usage:",
  "  orbit <command> [options]",
  "",
  "Start a working area:",
  "  init                         Initialize Orbit in the current project",
  "  clone <url> <directory>      Clone conversation history",
  "  dashboard                    Open the local conversation dashboard",
  "",
  "Capture and continue work:",
  "  claude [--continue]          Launch and capture Claude Code",
  "  codex [--continue]           Launch and capture Codex",
  "  new [title]                  Create a new workstream",
  "  switch <codex|claude>        Continue the latest conversation in another agent",
  "  continue <id> --agent <name> Continue a specific workstream",
  "  recover                      Recover an interrupted capture",
  "",
  "Inspect conversation history:",
  "  history                      List conversations, latest first",
  "  context <workstream>         Read normalized conversation context",
  "  status                       Show the current Orbit state",
  "  log                          Show conversation checkpoints",
  "  diff <from> <to>             Compare two checkpoints",
  "",
  "Version conversation history:",
  "  commit -m <message>          Create a named checkpoint",
  "  branch <name> [checkpoint]   Create a conversation branch",
  "  checkout <branch>            Switch conversation branches",
  "  session delete <id>          Remove a session from the current revision",
  "  workstream delete <id>       Remove a workstream from the current revision",
  "",
  "Collaborate:",
  "  remote add <name> <url>      Add a conversation-history remote",
  "  push [remote]                Push conversation history",
  "  fetch [remote]               Fetch conversation history",
  "  pull [remote]                Pull conversation history",
  "  publish <command>            Configure automatic dashboard publishing",
  "  auth <login|logout|status>   Manage dashboard authentication",
  "",
  "Import and intelligence:",
  "  import                       Discover and import native agent sessions",
  "  providers                    Inspect local intelligence providers",
  "  intelligence configure       Configure a local intelligence provider",
  "  summarize <session-id>       Summarize a captured session",
  "  migrate [--dry-run]          Import legacy Orbit history",
  "  export-legacy <id> <file>    Download a legacy cloud export",
  "",
  "Global options:",
  "  -h, --help                   Show this help",
  "  -v, --version                Show the installed Orbit version",
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
  if (command === "dashboard") {
    if (args.length === 1 && args[0] === "--remote") console.log(serverUrl());
    else await dashboardCommand(args);
    return;
  }
  if (command === "serve")
    throw new Error(
      "Use orbit dashboard to open the local viewer. The separate orbit-dashboard repository provides hosted accounts.",
    );
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
  if (command === "context") {
    await contextCommand(root, pid, args);
    return;
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
      await attachViewer(root, pid);
      console.log(
        "Orbit initialized at " +
          root +
          "\nProject: " +
          pid +
          "\nLocal dashboard: orbit dashboard\nCloud publishing disabled",
      );
      return;
    }
    if (
      ["codex", "claude", "switch", "continue", "import", "new"].includes(
        command,
      )
    )
      await attachViewer(root, pid);
    if (await historyCommand({ command, args, repo, pid, root, project }))
      return;
    if (await memoryCommand({ command, args, repo, pid, root, project }))
      return;

    if (await publishCommand({ command, args, repo, pid, root, project }))
      return;

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
    await sessionCommand({ command, args, repo, pid, root, project });
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
