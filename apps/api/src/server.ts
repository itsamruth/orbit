import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  chmod,
  readFile,
  access,
  rm,
} from "node:fs/promises";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedBrowserOrigin } from "./origin.js";
import { gunzipSync } from "node:zlib";
import { Repository, DomainError, type SqlDatabase } from "@orbit/local-store";
import {
  GitRepository,
  git,
  gitText,
  head,
  listBranches,
  checkpoints,
  compare,
  snapshotRepository,
  readSnapshot,
  withLock,
} from "@orbit/git-store";
import type {
  Project,
  Entity,
  EntityKind,
  Session,
  Workstream,
} from "@orbit/contracts";
import { ProjectInput, ProjectPatch } from "@orbit/contracts";
import { registerAuth, type AuthConfig } from "./auth.js";
import {
  getIntelligenceSettings,
  importHistoricalSessions,
  listImportCandidates,
  listProviders,
  setIntelligenceSettings,
  summarizeSession,
} from "./memory.js";
export * from "./memory.js";
import { searchIndex } from "./search.js";
export * from "./search.js";
export interface ServerConfig extends AuthConfig {
  localRoot?: string;
  repositoryRoot?: string;
  webRoot?: string;
}
const validId = (id: string) => {
  if (!/^prj_[a-zA-Z0-9_-]{1,150}$/.test(id))
    throw new DomainError(400, "Invalid project ID");
  return id;
};
export async function buildServer(db: SqlDatabase, config: ServerConfig) {
  const app = Fastify({ bodyLimit: 1024 * 1024, logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: 60000 });
  const root = resolve(
    config.repositoryRoot ??
      process.env.ORBIT_REPOSITORIES ??
      (config.localRoot
        ? join(config.localRoot, ".orbit", "state", "portal")
        : ".orbit-cloud/repositories"),
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  const local = config.localRoot
    ? await GitRepository.open(config.localRoot)
    : null;
  const localProject = local
    ? (await readSnapshot(local.history)).project
    : null;
  const web = resolve(
    config.webRoot ??
      process.env.ORBIT_WEB_ROOT ??
      join(dirname(fileURLToPath(import.meta.url)), "../../web/dist"),
  );
  app.addHook("onRequest", async (req, reply) => {
    if (config.localRoot) {
      const host = new URL("http://" + req.headers.host).hostname;
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(host) ||
        (req.headers.origin &&
          !isAllowedBrowserOrigin(req.headers.origin, config.origin))
      )
        throw new DomainError(403, "Local portal request is not allowed");
    }
    if (req.url.startsWith("/git/")) {
      const authorization = req.headers.authorization;
      if (authorization?.startsWith("Basic ")) {
        const raw = Buffer.from(authorization.slice(6), "base64").toString(),
          colon = raw.indexOf(":");
        req.headers.authorization = "Bearer " + raw.slice(colon + 1);
      }
      if (!req.headers.authorization && !config.devAuth) {
        reply.header("WWW-Authenticate", 'Basic realm="Orbit Git"');
        throw new DomainError(401, "Authenticate to access this repository");
      }
    }
  });
  const account = await registerAuth(app, db, config);
  await db.query(
    "CREATE TABLE IF NOT EXISTS orbit_git_projects (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,metadata TEXT NOT NULL,indexed_revision TEXT,index_error TEXT)",
  );
  const activeReaders = new Set<import("fastify").FastifyRequest>();
  const retired: Awaited<ReturnType<typeof snapshotRepository>>[] = [];
  app.addHook("onRequest", async (req) => {
    activeReaders.add(req);
  });
  app.addHook("onResponse", async (req) => {
    activeReaders.delete(req);
    if (!activeReaders.size)
      for (const item of retired.splice(0)) await item.db.close();
  });
  const cache = new Map<
    string,
    Awaited<ReturnType<typeof snapshotRepository>>
  >();
  async function snapshot(path: string, revision = "HEAD") {
    const oid = await gitText(path, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      revision + "^{commit}",
    ]);
    const key = path + ":" + oid;
    let item = cache.get(key);
    if (!item) {
      item = await snapshotRepository(path, oid);
      cache.set(key, item);
      if (cache.size > 8) {
        const first = cache.keys().next().value!;
        const old = cache.get(first)!;
        cache.delete(first);
        retired.push(old);
      }
    }
    return item;
  }
  const pending = new Map<string, Promise<void>>();
  async function index(id: string) {
    if (pending.has(id)) return pending.get(id);
    const task = (async () => {
      const path = join(root, validId(id) + ".git"),
        oid = await head(path);
      if (!oid) return;
      for (const branch of await listBranches(path))
        await snapshot(path, branch.oid);
      const snap = await snapshot(path, oid);
      await db.query(
        "UPDATE orbit_git_projects SET metadata=$1,indexed_revision=$2,index_error=$3 WHERE id=$4",
        [JSON.stringify(snap.snapshot.project), oid, null, id],
      );
    })()
      .catch(async (e) => {
        await db.query(
          "UPDATE orbit_git_projects SET index_error=$1 WHERE id=$2",
          ["Indexing failed; retrying", id],
        );
      })
      .finally(() => {
        pending.delete(id);
        if (!activeReaders.size)
          for (const item of retired.splice(0)) void item.db.close();
      });
    pending.set(id, task);
    return task;
  }
  const timer = setInterval(() => {
    void db
      .query<{ id: string }>("SELECT id FROM orbit_git_projects")
      .then((rows) => Promise.all(rows.map((r) => index(r.id))))
      .catch(() => {});
  }, 10000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await Promise.all(pending.values());
    for (const item of [...cache.values(), ...retired]) await item.db.close();
    await local?.db.close();
  });
  app.setErrorHandler((e, _req, reply) => {
    const status = (e as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({
      message:
        status >= 500
          ? "Orbit could not complete this request."
          : e instanceof Error
            ? e.message
            : String(e),
      error: status === 503 ? "index_pending" : "request_failed",
    });
  });
  app.get("/health", async () => ({
    status: "ok",
    service: "orbit-api",
    storage: "git",
  }));
  app.get("/ready", async () => {
    await db.query("SELECT 1");
    await gitText(root, ["--version"]);
    return { status: "ok" };
  });
  async function owner(req: import("fastify").FastifyRequest, id?: string) {
    const user = await account(req);
    id = validId(id ?? (req.params as { id: string }).id);
    if (local) {
      if (id !== localProject!.id)
        throw new DomainError(404, "Project not found");
      return { id, path: local.history, user };
    }
    const row = (
      await db.query<{ owner_id: string }>(
        "SELECT owner_id FROM orbit_git_projects WHERE id=$1",
        [id],
      )
    )[0];
    if (!row || row.owner_id !== user.id)
      throw new DomainError(404, "Project not found");
    return { id, path: join(root, id + ".git"), user };
  }
  app.get("/api/v1/projects", async (req) => {
    const user = await account(req);
    if (local)
      return {
        items: [(await snapshot(local.history)).snapshot.project],
        nextCursor: null,
      };
    const rows = await db.query<{ metadata: string }>(
      "SELECT metadata FROM orbit_git_projects WHERE owner_id=$1",
      [user.id],
    );
    return {
      items: rows.map((r) => ({
        ...JSON.parse(r.metadata),
        owner: user.login,
      })),
      nextCursor: null,
    };
  });
  app.post(
    "/api/v1/projects",
    { schema: { body: ProjectInput } },
    async (req) => {
      if (local)
        throw new DomainError(400, "Initialize projects with orbit init.");
      const user = await account(req),
        body = req.body as {
          id: string;
          name: string;
          description?: string;
          repository?: string | null;
        };
      const id = validId(body.id),
        now = new Date().toISOString(),
        project: Project = {
          id,
          name: body.name,
          description: body.description ?? "",
          repository: body.repository ?? null,
          owner: user.login,
          createdAt: now,
          updatedAt: now,
          cloudSyncEnabled: false,
          excludedPaths: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key"],
        };
      await withLock(join(root, id + ".lock"), async () => {
        const prior = (
          await db.query<{ owner_id: string; metadata: string }>(
            "SELECT owner_id,metadata FROM orbit_git_projects WHERE id=$1",
            [id],
          )
        )[0];
        if (prior) {
          if (prior.owner_id !== user.id)
            throw new DomainError(
              409,
              "Project identity is already registered",
            );
          return;
        }
        const path = join(root, id + ".git");
        await mkdir(path, { recursive: true, mode: 0o700 });
        await git(path, ["init", "--bare", "--initial-branch=main"]);
        for (const [key, value] of [
          ["http.receivepack", "true"],
          ["http.getanyfile", "false"],
          ["receive.denyNonFastForwards", "true"],
          ["receive.denyDeletes", "true"],
          ["receive.maxInputSize", "104857600"],
        ])
          await git(path, ["config", key!, value!]);
        const hookPath =
          process.env.ORBIT_RECEIVE_HOOK ??
          join(dirname(fileURLToPath(import.meta.url)), "receive-hook.js");
        const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
        await writeFile(
          join(path, "hooks", "pre-receive"),
          "#!/bin/sh\nexec " +
            quote(process.execPath) +
            " " +
            quote(hookPath) +
            " " +
            quote(id) +
            "\n",
          { mode: 0o700 },
        );
        await chmod(join(path, "hooks", "pre-receive"), 0o700);
        await db.query(
          "INSERT INTO orbit_git_projects (id,owner_id,metadata) VALUES ($1,$2,$3)",
          [id, user.id, JSON.stringify(project)],
        );
      });
      return project;
    },
  );
  app.get("/api/v1/projects/:id", async (req) => {
    const { path, id } = await owner(req),
      q = req.query as { revision?: string };
    if (!(await head(path))) {
      const row = (
        await db.query<{ metadata: string }>(
          "SELECT metadata FROM orbit_git_projects WHERE id=$1",
          [id],
        )
      )[0];
      return JSON.parse(row!.metadata);
    }
    const s = await snapshot(path, q.revision);
    return { ...s.snapshot.project, revision: s.snapshot.revision };
  });
  app.get("/api/v1/projects/:id/status", async (req) => {
    const { id, path } = await owner(req);
    if (local) return local.status();
    const oid = await head(path),
      row = (
        await db.query<{
          indexed_revision: string | null;
          index_error: string | null;
        }>(
          "SELECT indexed_revision,index_error FROM orbit_git_projects WHERE id=$1",
          [id],
        )
      )[0]!;
    return {
      head: oid,
      branch: "main",
      branches: await listBranches(path),
      uncheckpointed: 0,
      unpushed: 0,
      mode: "hosted",
      indexedRevision: row.indexed_revision,
      indexError: row.index_error,
      publishing: { enabled: true, lastSuccess: null, error: null },
    };
  });
  app.get("/api/v1/projects/:id/branches", async (req) => ({
    items: await listBranches((await owner(req)).path),
    nextCursor: null,
  }));
  app.get("/api/v1/projects/:id/checkpoints", async (req) => {
    const { path } = await owner(req),
      q = req.query as { revision?: string; cursor?: string };
    if (!(await head(path))) return { items: [], nextCursor: null };
    const ref = q.cursor
      ? decodeCursor(q.cursor).revision
      : (q.revision ?? "HEAD");
    const start = q.cursor ? decodeCursor(q.cursor).offset : 0;
    const all = await checkpoints(path, ref, 51, start),
      revision = await gitText(path, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        ref + "^{commit}",
      ]);
    return {
      items: all.slice(0, 50),
      nextCursor: all.length > 50 ? encodeCursor(revision, start + 50) : null,
      revision,
    };
  });
  app.get("/api/v1/projects/:id/compare", async (req) => {
    const { path } = await owner(req),
      q = req.query as { from?: string; to?: string };
    if (!q.from || !q.to)
      throw new DomainError(400, "Specify from and to checkpoints");
    return compare(path, q.from, q.to);
  });
  for (const [collection, kind] of [
    ["workstreams", "workstream"],
    ["sessions", "session"],
  ] as const) {
    app.get("/api/v1/projects/:id/" + collection, async (req) => {
      const { path, id } = await owner(req),
        q = req.query as {
          revision?: string;
          cursor?: string;
          workstreamId?: string;
          allBranches?: string;
        };
      if (!(await head(path))) return { items: [], nextCursor: null };
      if (q.allBranches === "1") {
        const items = new Map<
          string,
          Entity & { branches: string[]; revision: string }
        >();
        for (const b of await listBranches(path)) {
          const s = await snapshot(path, b.oid);
          for (const data of await s.repo.list(id, kind)) {
            const prior = items.get(data.id);
            if (prior) prior.branches.push(b.name);
            else
              items.set(data.id, {
                ...data,
                branches: [b.name],
                revision: b.oid,
              });
          }
        }
        return { items: [...items.values()], nextCursor: null };
      }
      const cursor = q.cursor ? decodeCursor(q.cursor) : null;
      const s = await snapshot(path, cursor?.revision ?? q.revision);
      const page = await s.repo.page(
        id,
        kind,
        q.workstreamId,
        cursor ? String(cursor.offset) : null,
        100,
      );
      return {
        ...page,
        nextCursor: page.nextCursor
          ? encodeCursor(s.snapshot.revision, Number(page.nextCursor))
          : null,
        revision: s.snapshot.revision,
      };
    });
    app.get("/api/v1/projects/:id/" + collection + "/:entity", async (req) => {
      const { path, id } = await owner(req),
        q = req.query as { revision?: string };
      const s = await snapshot(path, q.revision),
        entity = await s.repo.get(
          id,
          kind,
          (req.params as { entity: string }).entity,
        );
      if (!entity)
        throw new DomainError(404, "Conversation not found at this revision");
      return { ...entity, revision: s.snapshot.revision };
    });
    app.delete(
      "/api/v1/projects/:id/" + collection + "/:entity",
      async (req) => {
        const { path, id } = await owner(req);
        await mutate(
          path,
          id,
          req,
          async (repo) => {
            await repo.remove(
              id,
              kind,
              (req.params as { entity: string }).entity,
            );
          },
          "Remove " + kind + " from current revision",
        );
        return {
          ok: true,
          message: "Earlier Git commits retain this conversation.",
        };
      },
    );
  }
  app.get("/api/v1/projects/:id/sessions/:entity/events", async (req) => {
    const { path, id } = await owner(req),
      q = req.query as { revision?: string; cursor?: string };
    const cursor = q.cursor ? decodeCursor(q.cursor) : null,
      s = await snapshot(path, cursor?.revision ?? q.revision);
    const page = await s.repo.page(
      id,
      "event",
      (req.params as { entity: string }).entity,
      cursor ? String(cursor.offset) : null,
      50,
    );
    return {
      ...page,
      nextCursor: page.nextCursor
        ? encodeCursor(s.snapshot.revision, Number(page.nextCursor))
        : null,
      revision: s.snapshot.revision,
    };
  });
  async function mutate(
    path: string,
    id: string,
    req: import("fastify").FastifyRequest,
    fn: (repo: GitRepository) => Promise<void>,
    message: string,
  ) {
    const q = req.query as { branch?: string; revision?: string };
    if (q.revision)
      throw new DomainError(
        409,
        "Historical revisions are read only; select a branch to edit.",
      );
    if (local) {
      await local.assertIdle();
      if (q.branch && q.branch !== (await local.status()).branch)
        throw new DomainError(
          409,
          "Select the checked-out conversation branch to edit.",
        );
      await local.exclusive(() => local.refresh());
      await fn(local);
      await local.checkpoint(message);
      return;
    }
    await withLock(join(root, id + ".lock"), async () => {
      const branch = q.branch ?? "main",
        branches = await listBranches(path),
        base = branches.find((b) => b.name === branch);
      if (!base) throw new DomainError(404, "Branch not found");
      const dir = join(root, id + ".edit");
      await mkdir(join(dir, ".orbit"), { recursive: true });
      await rm(join(dir, ".orbit", "history"), {
        recursive: true,
        force: true,
      });
      await rm(join(dir, ".orbit", "state"), { recursive: true, force: true });
      await git(dir, [
        "clone",
        "--no-local",
        "--branch",
        branch,
        "--",
        path,
        join(dir, ".orbit", "history"),
      ]);
      const repo = await GitRepository.open(dir, true);
      try {
        await fn(repo);
        const oid = await repo.checkpoint(message);
        await git(path, ["fetch", repo.history, branch]);
        await git(path, ["update-ref", "refs/heads/" + branch, oid!, base.oid]);
      } finally {
        await repo.db.close();
      }
      await index(id);
    });
  }
  app.patch(
    "/api/v1/projects/:id",
    { schema: { body: ProjectPatch } },
    async (req) => {
      const { path, id } = await owner(req);
      const body = req.body as Partial<Project>;
      if ("cloudSyncEnabled" in body)
        throw new DomainError(
          400,
          "Publishing is a local checkout setting. Use orbit publish enable or disable.",
        );
      await mutate(
        path,
        id,
        req,
        async (repo) => {
          const project = await repo.get<Project>(id, "project", id);
          await repo.put(id, "project", {
            ...project!,
            ...body,
            updatedAt: new Date().toISOString(),
          });
        },
        "Update project settings",
      );
      return (await snapshot(path, (req.query as { branch?: string }).branch))
        .snapshot.project;
    },
  );
  app.patch("/api/v1/projects/:id/workstreams/:entity", async (req) => {
    const { path, id } = await owner(req),
      title = (req.body as { title?: unknown }).title;
    if (typeof title !== "string" || !title.trim() || title.length > 200)
      throw new DomainError(400, "Invalid workstream title");
    await mutate(
      path,
      id,
      req,
      async (repo) => {
        const w = await repo.get<Workstream>(
          id,
          "workstream",
          (req.params as { entity: string }).entity,
        );
        if (!w) throw new DomainError(404, "Workstream not found");
        await repo.put(id, "workstream", {
          ...w,
          title,
          updatedAt: new Date().toISOString(),
        });
      },
      "Rename workstream",
    );
    return { ok: true };
  });
  app.delete("/api/v1/projects/:id", async (req) => {
    const { id, path } = await owner(req);
    if (local)
      throw new DomainError(
        400,
        "Local project removal is a filesystem operation; earlier Git history is retained.",
      );
    await withLock(join(root, id + ".lock"), async () => {
      await db.query("DELETE FROM orbit_git_projects WHERE id=$1", [id]);
      await rm(path, { recursive: true, force: true });
    });
    return {
      ok: true,
      message:
        "Hosted repository removed. Other clones and backups are independent copies.",
    };
  });
  app.get("/api/v1/legacy/projects/:id/export", async (req) => {
    const user = await account(req),
      id = validId((req.params as { id: string }).id);
    const owned = await db.query(
      "SELECT project_id FROM orbit_owners WHERE project_id=$1 AND user_id=$2",
      [id, user.id],
    );
    if (!owned.length) throw new DomainError(404, "Legacy project not found");
    const repo = new Repository(db),
      records = [];
    for (const kind of ["project", "workstream", "session", "event"] as const)
      for (const data of await repo.list(id, kind))
        records.push({ kind, data });
    return { format: "orbit-legacy-export-v1", projectId: id, records };
  });
  app.post("/api/v1/projects/:id/sync", async () => {
    throw new DomainError(
      410,
      "Conversation sync was replaced by Git push and fetch.",
    );
  });
  for (const type of [
    "application/x-git-upload-pack-request",
    "application/x-git-receive-pack-request",
  ])
    app.addContentTypeParser(type, { parseAs: "buffer" }, (_req, body, done) =>
      done(null, body),
    );
  app.route({
    method: ["GET", "POST"],
    url: "/git/*",
    bodyLimit: 100 * 1024 * 1024,
    handler: async (req, reply) => {
      if (local)
        throw new DomainError(404, "Local portal does not host Git remotes.");
      const url = new URL(req.url, config.origin),
        match =
          /^\/git\/(prj_[a-zA-Z0-9_-]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(
            url.pathname,
          );
      if (!match) throw new DomainError(404, "Unknown Git endpoint");
      const { id, path, user } = await owner(req, match[1]);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const input =
        req.headers["content-encoding"] === "gzip"
          ? gunzipSync(body, { maxOutputLength: 100 * 1024 * 1024 })
          : body;
      const output = await new Promise<Buffer>((resolve, reject) => {
        const env = { ...process.env };
        for (const key of Object.keys(env))
          if (key.startsWith("GIT_")) delete env[key];
        const child = spawn("git", ["http-backend"], {
          env: {
            ...env,
            GIT_PROJECT_ROOT: root,
            GIT_HTTP_EXPORT_ALL: "1",
            PATH_INFO: "/" + id + ".git/" + match[2],
            QUERY_STRING: url.search.slice(1),
            REQUEST_METHOD: req.method,
            CONTENT_TYPE: String(req.headers["content-type"] ?? ""),
            CONTENT_LENGTH: String(input.length),
            REMOTE_USER: user.id,
            SERVER_PROTOCOL: "HTTP/1.1",
            GIT_PROTOCOL: String(req.headers["git-protocol"] ?? ""),
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        const chunks: Buffer[] = [];
        let bytes = 0;
        const timeout = setTimeout(() => child.kill("SIGKILL"), 60000);
        child.stdout.on("data", (b: Buffer) => {
          bytes += b.length;
          if (bytes > 128 * 1024 * 1024) child.kill("SIGKILL");
          else chunks.push(b);
        });
        child.stderr.resume();
        child.stdin.on("error", () => {});
        child.stdin.end(input);
        child.on("error", (e) => {
          clearTimeout(timeout);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code) reject(new DomainError(502, "Git transport failed"));
          else resolve(Buffer.concat(chunks));
        });
      });
      const boundary = output.indexOf("\r\n\r\n");
      if (boundary < 0)
        throw new DomainError(502, "Invalid Git transport response");
      for (const line of output
        .subarray(0, boundary)
        .toString()
        .split("\r\n")) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const name = line.slice(0, colon),
          value = line.slice(colon + 1).trim();
        if (name.toLowerCase() === "status")
          reply.code(Number(value.split(" ")[0]));
        else reply.header(name, value);
      }
      if (match[2] === "git-receive-pack") void index(id).catch(() => {});
      return reply.send(output.subarray(boundary + 4));
    },
  });
  app.get("/api/v1/projects/:id/summaries", async (req) => {
    const { path, id } = await owner(req),
      q = req.query as { revision?: string };
    if (!(await head(path))) return { items: [], nextCursor: null };
    const s = await snapshot(path, q.revision);
    return { items: await s.repo.list(id, "summary"), nextCursor: null, revision: s.snapshot.revision };
  });
  app.get("/api/v1/projects/:id/search", async (req) => {
    const { path, id } = await owner(req),
      q = req.query as { q?: string; agent?: string; branch?: string; type?: "event" | "summary"; from?: string; to?: string; cursor?: string; revision?: string };
    const query = (q.q ?? "").trim();
    if (!query || query.length > 200) throw new DomainError(400, "Enter a search query up to 200 characters");
    const s = await snapshot(path, q.revision);
    const result = await searchIndex(s.repo as GitRepository, id, s.snapshot.revision, {
      query,
      agent: q.agent,
      branch: q.branch,
      type: q.type,
      from: q.from,
      to: q.to,
      cursor: Number(q.cursor ?? 0),
    });
    return { ...result, revision: s.snapshot.revision };
  });
  if (local && config.localRoot) {
    const localRepo = local;
    const localRoot = config.localRoot;
    app.get("/api/v1/projects/:id/import/candidates", async (req) => {
      const { id } = await owner(req);
      return { items: await listImportCandidates(localRepo, id, localRoot) };
    });
    app.post("/api/v1/projects/:id/import", async (req) => {
      const { id } = await owner(req);
      const body = req.body as { candidateIds?: unknown; summarize?: unknown };
      if (!Array.isArray(body?.candidateIds) || !body.candidateIds.every((x) => typeof x === "string"))
        throw new DomainError(400, "Select valid import candidates");
      if (body.candidateIds.length > 200)
        throw new DomainError(400, "Import at most 200 conversations at a time");
      return importHistoricalSessions(localRepo, id, localRoot, body.candidateIds, body.summarize === true);
    });
    app.get("/api/v1/projects/:id/providers", async (req) => {
      await owner(req);
      return { items: await listProviders() };
    });
    app.get("/api/v1/projects/:id/intelligence/settings", async (req) => {
      await owner(req);
      return getIntelligenceSettings(localRepo);
    });
    app.put("/api/v1/projects/:id/intelligence/settings", async (req) => {
      await owner(req);
      const body = req.body as import("@orbit/contracts").IntelligenceSettings;
      return setIntelligenceSettings(localRepo, body);
    });
    app.post("/api/v1/projects/:id/sessions/:entity/summary", async (req) => {
      const { id } = await owner(req);
      const body = (req.body ?? {}) as { provider?: "codex" | "claude"; force?: boolean };
      return summarizeSession(localRepo, id, (req.params as { entity: string }).entity, body.provider, body.force === true);
    });
    app.get("/api/v1/projects/:id/sessions/:entity/summary-job", async (req) => {
      await owner(req);
      return JSON.parse((await localRepo.state("summary:job:" + (req.params as { entity: string }).entity)) ?? '{"status":"idle"}');
    });
    app.get("/api/v1/projects/:id/publish/selection", async (req) => {
      await owner(req);
      return { sessionIds: JSON.parse((await localRepo.state("publish:selected:sessions")) ?? "[]") };
    });
    app.put("/api/v1/projects/:id/publish/selection", async (req) => {
      const { id } = await owner(req);
      const body = req.body as { sessionIds?: unknown };
      if (!Array.isArray(body?.sessionIds) || !body.sessionIds.every((x) => typeof x === "string"))
        throw new DomainError(400, "Select valid sessions");
      const sessions = await localRepo.list<Session>(id, "session");
      const valid = new Set(sessions.map((session) => session.id));
      if (!body.sessionIds.every((sessionId) => valid.has(sessionId as string)))
        throw new DomainError(400, "A selected session does not belong to this project");
      await localRepo.setState("publish:selected:sessions", JSON.stringify([...new Set(body.sessionIds)]));
      return { sessionIds: body.sessionIds };
    });
  }
  app.get("/*", async (req, reply) => {
    if (req.url.startsWith("/api/"))
      throw new DomainError(404, "Unknown API endpoint");
    const pathname = new URL(req.url, config.origin).pathname;
    const asset = pathname.startsWith("/assets/");
    const path = asset ? resolve(web, "." + pathname) : join(web, "index.html");
    if (!path.startsWith(web + "/")) throw new DomainError(404, "Not found");
    const mime: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    try {
      reply
        .header("Referrer-Policy", "no-referrer")
        .header("X-Content-Type-Options", "nosniff");
      return reply
        .type(mime[extname(path)] ?? "application/octet-stream")
        .send(await readFile(path));
    } catch {
      throw new DomainError(
        404,
        "Build the frontend before running orbit serve.",
      );
    }
  });
  return app;
}
function encodeCursor(revision: string, offset: number) {
  return Buffer.from(JSON.stringify({ revision, offset })).toString(
    "base64url",
  );
}
function decodeCursor(raw: string): { revision: string; offset: number } {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (
      !/^[a-f0-9]{40,64}$/.test(c.revision) ||
      !Number.isSafeInteger(c.offset) ||
      c.offset < 0
    )
      throw 0;
    return c;
  } catch {
    throw new DomainError(400, "Invalid revision cursor");
  }
}
