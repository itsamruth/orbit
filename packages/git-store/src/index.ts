import { mkdir, readdir, readFile, unlink, rm, access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Repository, SqliteDatabase, DomainError } from "@orbit/local-store";
import type {
  Entity,
  EntityKind,
  UniversalEvent,
  Checkpoint,
  ConversationBranch,
  RepositoryStatus,
} from "@orbit/contracts";
import {
  git,
  gitText,
  head,
  branchName,
  atomicWrite,
  withLock,
} from "./git.js";
import { readSnapshot, loadSnapshot } from "./snapshot.js";
export * from "./git.js";
export * from "./snapshot.js";
export class GitRepository extends Repository {
  private tail: Promise<unknown> = Promise.resolve();
  readonly history: string;
  readonly local: string;
  constructor(
    readonly root: string,
    db?: SqliteDatabase,
  ) {
    super(
      db ?? new SqliteDatabase(join(root, ".orbit", "state", "journal.sqlite")),
    );
    this.history = join(root, ".orbit", "history");
    this.local = join(root, ".orbit", "state");
    (this.db as SqliteDatabase).raw.pragma("synchronous = FULL");
  }
  static async open(root: string, initialize = false) {
    root = resolve(root);
    if (!initialize) await access(join(root, ".orbit", "history", ".git"));
    const repo = new GitRepository(root);
    try {
      await repo.exclusive(async () => {
        if (initialize) {
          await mkdir(repo.history, { recursive: true, mode: 0o700 });
          try {
            await access(join(repo.history, ".git"));
          } catch {
            await git(repo.history, ["init", "--initial-branch=main"]);
          }
          for (const [key, value] of [
            ["user.name", "Orbit"],
            ["user.email", "orbit@localhost"],
          ]) {
            try {
              await gitText(repo.history, ["config", "--get", key!]);
            } catch {
              await git(repo.history, ["config", "--local", key!, value!]);
            }
          }
          await git(repo.history, [
            "config",
            "--local",
            "core.logAllRefUpdates",
            "true",
          ]);
          await git(repo.history, [
            "config",
            "--local",
            "commit.gpgSign",
            "false",
          ]);
        }
        await repo.refresh();
      });
      return repo;
    } catch (e) {
      await repo.db.close();
      throw e;
    }
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await withLock(this.local, fn);
    } finally {
      release();
    }
  }
  async refresh() {
    const current = await head(this.history),
      stored = await this.state("git:head");
    const intent = await this.state("git:intent");
    if (intent && current) {
      const x = JSON.parse(intent) as { tree: string; parent: string | null };
      const tree = await gitText(this.history, [
        "rev-parse",
        current + "^{tree}",
      ]);
      const parents = (
        await gitText(this.history, ["show", "-s", "--format=%P", current])
      )
        .split(" ")
        .filter(Boolean);
      if (
        tree === x.tree &&
        (x.parent
          ? parents.length === 1 && parents[0] === x.parent
          : !parents.length)
      ) {
        await git(this.history, ["read-tree", "--reset", "-u", current]);
        await this.finish(current);
        return;
      }
    }
    if (current === stored) return;
    const pending = await this.db.query("SELECT id FROM orbit_outbox LIMIT 1");
    if (pending.length)
      throw new DomainError(
        409,
        "Git history changed with uncheckpointed capture. Recover before continuing.",
      );
    if (current)
      await loadSnapshot(this, await readSnapshot(this.history, current));
  }
  private async finish(oid: string) {
    await this.db.transaction(async (db) => {
      await db.query("DELETE FROM orbit_outbox");
      await db.query("DELETE FROM orbit_state WHERE key=$1", ["git:intent"]);
      await this.setState("git:head", oid, db);
    });
  }
  override async put(
    pid: string,
    kind: EntityKind,
    data: Entity,
    _outbox = true,
  ) {
    await this.exclusive(async () => {
      await this.refresh();
      await super.put(pid, kind, data, true);
    });
  }
  override async remove(
    pid: string,
    kind: EntityKind,
    id: string,
    _outbox = true,
  ) {
    if (kind === "project")
      throw new DomainError(
        400,
        "Use hosted project deletion or remove the local repository explicitly; deleting the versioned manifest is not supported.",
      );
    await this.exclusive(async () => {
      await this.assertIdle();
      await this.refresh();
      await super.remove(pid, kind, id, true);
    });
  }
  override async capture(
    pid: string,
    source: string,
    position: number,
    events: UniversalEvent[],
    state?: { key: string; value: string },
  ) {
    await this.exclusive(async () => {
      await this.refresh();
      await super.capture(pid, source, position, events, state);
    });
  }
  async assertIdle() {
    try {
      await access(join(this.root, ".orbit", "process.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    throw new DomainError(
      409,
      "An Orbit session owns this checkout. Stop it or run orbit recover first.",
    );
  }
  async checkpoint(
    message = "Conversation checkpoint",
  ): Promise<string | null> {
    return this.exclusive(async () => {
      await this.refresh();
      if (!(await this.db.query("SELECT id FROM orbit_outbox LIMIT 1")).length)
        return head(this.history);
      if (await gitText(this.history, ["status", "--porcelain"]))
        throw new DomainError(
          409,
          "Conversation working files were changed outside Orbit. Commit or restore them with Git first.",
        );
      const parent = await head(this.history);
      const branch = await gitText(this.history, [
        "symbolic-ref",
        "--quiet",
        "HEAD",
      ]);
      const files = new Map<string, string>();
      const rows = await this.db.query<{ kind: EntityKind; data: string }>(
        "SELECT kind,data FROM orbit_entities ORDER BY ordinal,id",
      );
      const events = new Map<string, UniversalEvent[]>();
      for (const row of rows) {
        const data = JSON.parse(row.data) as Entity;
        if (row.kind === "project")
          files.set(
            "orbit.json",
            JSON.stringify(
              {
                formatVersion: 2,
                project: { ...data, cloudSyncEnabled: false },
              },
              null,
              2,
            ) + "\n",
          );
        else if (row.kind === "event") {
          const e = data as UniversalEvent;
          const list = events.get(e.sessionId) ?? [];
          list.push(e);
          events.set(e.sessionId, list);
        } else
          files.set(
            row.kind + "s/" + data.id + ".json",
            JSON.stringify(data, null, 2) + "\n",
          );
      }
      if (!files.has("orbit.json"))
        throw new DomainError(409, "Project manifest is missing");
      for (const [session, list] of events) {
        list.sort((a, b) => a.sequence - b.sequence);
        let chunk: UniversalEvent[] = [],
          size = 0;
        const flush = () => {
          if (!chunk.length) return;
          const body = chunk.map((e) => JSON.stringify(e)).join("\n") + "\n";
          files.set(
            "events/" +
              session +
              "/" +
              createHash("sha256").update(body).digest("hex") +
              ".jsonl",
            body,
          );
          chunk = [];
          size = 0;
        };
        for (const e of list) {
          const n = Buffer.byteLength(JSON.stringify(e)) + 1;
          if (size + n > 900000 || chunk.length >= 64) flush();
          chunk.push(e);
          size += n;
        }
        flush();
      }
      // Build a private index, then atomically update the ref. No partial working-tree export can become a checkpoint.
      const index = join(this.local, "checkpoint.index");
      await unlink(index).catch(() => {});
      const env = { GIT_INDEX_FILE: index };
      await git(this.history, ["read-tree", "--empty"], { env });
      const entries: string[] = [];
      for (const [path, body] of files) {
        const oid = await gitText(
          this.history,
          ["hash-object", "-w", "--stdin"],
          { input: body },
        );
        entries.push("100644 " + oid + "\t" + path + "\0");
      }
      await git(this.history, ["update-index", "-z", "--index-info"], {
        env,
        input: entries.join(""),
      });
      const tree = await gitText(this.history, ["write-tree"], { env });
      if (
        parent &&
        tree ===
          (await gitText(this.history, ["rev-parse", parent + "^{tree}"]))
      ) {
        await this.finish(parent);
        await unlink(index).catch(() => {});
        return parent;
      }
      await this.setState("git:intent", JSON.stringify({ tree, parent }));
      const oid = await gitText(
        this.history,
        ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-F", "-"],
        { input: message + "\n" },
      );
      await git(this.history, ["update-ref", branch, oid, parent ?? ""]);
      // Restore managed files only after the durable commit exists.
      await git(this.history, ["read-tree", "--reset", "-u", oid]);
      await this.finish(oid);
      await unlink(index).catch(() => {});
      return oid;
    });
  }
  async branches(): Promise<ConversationBranch[]> {
    return listBranches(this.history);
  }
  async log(ref = "HEAD", limit = 100): Promise<Checkpoint[]> {
    return checkpoints(this.history, ref, limit);
  }
  async validateTarget(revision: string) {
    const target = await readSnapshot(this.history, revision);
    const project = (
      await this.db.query<{ id: string }>(
        "SELECT id FROM orbit_entities WHERE kind=$1",
        ["project"],
      )
    )[0];
    if (project && target.project.id !== project.id)
      throw new DomainError(
        409,
        "Target revision belongs to another Orbit project",
      );
    return target;
  }
  async createBranch(name: string, revision = "HEAD") {
    await this.exclusive(async () => {
      await this.assertIdle();
      await this.refresh();
      await this.requireClean();
      await branchName(this.history, name);
      const rev = await import("./git.js").then((m) =>
        m.resolveRevision(this.history, revision),
      );
      await this.validateTarget(rev);
      await git(this.history, ["branch", name, rev]);
    });
  }
  async checkout(name: string) {
    await this.exclusive(async () => {
      await this.assertIdle();
      await this.refresh();
      await this.requireClean();
      await branchName(this.history, name);
      await this.validateTarget("refs/heads/" + name);
      await git(this.history, ["checkout", name, "--"]);
      await this.refresh();
    });
  }
  async requireClean() {
    if ((await this.db.query("SELECT id FROM orbit_outbox LIMIT 1")).length)
      throw new DomainError(
        409,
        "Create a checkpoint before changing history.",
      );
    if (await gitText(this.history, ["status", "--porcelain"]))
      throw new DomainError(
        409,
        "Conversation working files were changed outside Orbit. Commit or restore them with Git first.",
      );
  }
  async remote(name: string, url: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name))
      throw new DomainError(400, "Invalid remote name");
    validateRemote(url);
    await this.exclusive(() => git(this.history, ["remote", "add", name, url]));
  }
  async push(remote = "origin", env: NodeJS.ProcessEnv = {}, timeout = 30000) {
    if (!/^[a-zA-Z0-9_-]+$/.test(remote))
      throw new DomainError(400, "Invalid remote name");
    const branches = await this.branches();
    if (!branches.length) return;
    try {
      await git(
        this.history,
        [
          "push",
          "--porcelain",
          remote,
          ...branches.map(
            (b) => "refs/heads/" + b.name + ":refs/heads/" + b.name,
          ),
        ],
        { env, timeout },
      );
      await this.setState("publish:last", new Date().toISOString());
      await this.setState("publish:error", "");
    } catch (e) {
      await this.setState("publish:error", String(e));
      throw e;
    }
  }
  async fetch(remote = "origin", env: NodeJS.ProcessEnv = {}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(remote))
      throw new DomainError(400, "Invalid remote name");
    await git(this.history, ["fetch", remote], { env });
  }
  async pull(remote = "origin", env: NodeJS.ProcessEnv = {}) {
    await this.exclusive(async () => {
      await this.assertIdle();
      await this.refresh();
      await this.requireClean();
      await this.fetch(remote, env);
      const name = await gitText(this.history, [
        "symbolic-ref",
        "--short",
        "HEAD",
      ]);
      await this.validateTarget("refs/remotes/" + remote + "/" + name);
      await git(this.history, [
        "merge",
        "--ff-only",
        "refs/remotes/" + remote + "/" + name,
      ]);
      await this.refresh();
    });
  }
  async status(): Promise<RepositoryStatus> {
    const oid = await head(this.history),
      branches = await this.branches();
    const branch = await gitText(this.history, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]).catch(() => null);
    const unpushed = Number(
      await gitText(this.history, [
        "rev-list",
        "--count",
        "--branches",
        "--not",
        "--remotes=origin",
      ]).catch(() => "0"),
    );
    return {
      head: oid,
      branch,
      branches,
      uncheckpointed: Number(
        (
          await this.db.query<{ n: number }>(
            "SELECT COUNT(*) AS n FROM orbit_outbox",
          )
        )[0]!.n,
      ),
      unpushed,
      publishing: {
        enabled: (await this.state("publish:enabled")) === "true",
        lastSuccess: await this.state("publish:last"),
        error: (await this.state("publish:error")) || null,
      },
      mode: "local",
      indexedRevision: oid,
    };
  }
}
export async function listBranches(
  path: string,
): Promise<ConversationBranch[]> {
  const raw = await gitText(path, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)",
    "refs/heads/",
  ]);
  return raw
    ? raw.split("\n").map((s) => {
        const [name, oid] = s.split("\t");
        return { name: name!, oid: oid! };
      })
    : [];
}
export async function checkpoints(
  path: string,
  ref = "HEAD",
  limit = 100,
  skip = 0,
): Promise<Checkpoint[]> {
  const revision = await import("./git.js").then((m) =>
    m.resolveRevision(path, ref),
  );
  const out = await gitText(path, [
    "log",
    "-n",
    String(Math.max(1, Math.min(limit, 1000))),
    "--skip=" + String(Math.max(0, Math.floor(skip))),
    "--format=%H%x09%P%x09%aI%x09%an%x09%s",
    revision,
    "--",
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [oid, parents, createdAt, author, ...message] = line.split("\t");
      return {
        oid: oid!,
        parents: parents ? parents.split(" ") : [],
        createdAt: createdAt!,
        author: author!,
        message: message.join("\t"),
      };
    });
}
export function validateRemote(url: string) {
  if (
    !url ||
    url.startsWith("-") ||
    /[\x00-\x20]/.test(url) ||
    url.startsWith("ext::")
  )
    throw new DomainError(400, "Invalid Git remote");
  if (url.includes("://")) {
    const u = new URL(url);
    if (
      !["https:", "ssh:", "file:", "http:"].includes(u.protocol) ||
      u.password ||
      u.search ||
      u.hash ||
      (u.protocol === "https:" && u.username) ||
      (u.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    )
      throw new DomainError(
        400,
        "Use HTTPS, SSH, or a local Git remote without embedded credentials.",
      );
  } else if (url.includes("::"))
    throw new DomainError(400, "Unsupported remote helper");
}
export async function cloneRepository(
  url: string,
  root: string,
  env: NodeJS.ProcessEnv = {},
) {
  validateRemote(url);
  await mkdir(root, { recursive: true });
  try {
    await access(join(root, ".orbit"));
    throw new Error("Destination already has Orbit metadata");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const dir = join(root, ".orbit");
  await mkdir(dir, { mode: 0o700 });
  try {
    await git(
      root,
      ["clone", "--no-checkout", "--", url, join(dir, "history")],
      { env, timeout: 60000 },
    );
    const snap = await readSnapshot(join(dir, "history"));
    await git(join(dir, "history"), [
      "read-tree",
      "--reset",
      "-u",
      snap.revision,
    ]);
    // Track each remote conversation branch so the dashboard and future pushes include them.
    const remoteRefs = await gitText(join(dir, "history"), [
      "for-each-ref",
      "--format=%(refname:strip=3)",
      "refs/remotes/origin",
    ]);
    for (const name of remoteRefs
      .split("\n")
      .filter((x) => x && x !== "HEAD")) {
      const exists = await gitText(join(dir, "history"), [
        "show-ref",
        "--verify",
        "refs/heads/" + name,
      ]).then(
        () => true,
        () => false,
      );
      if (!exists)
        await git(join(dir, "history"), [
          "branch",
          name,
          "refs/remotes/origin/" + name,
        ]);
    }
    await atomicWrite(
      join(dir, "project.json"),
      JSON.stringify({ version: 1, projectId: snap.project.id }) + "\n",
    );
    return await GitRepository.open(root, true);
  } catch (e) {
    throw new Error(
      "Clone incomplete; preserved destination for inspection. " + String(e),
    );
  }
}
