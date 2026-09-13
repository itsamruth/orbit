import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Entity,
  EntityKind,
  Page,
  Project,
  Session,
  UniversalEvent,
  Workstream,
} from "../protocol/index.js";
import {
  Repository,
  SqliteDatabase,
  DomainError,
} from "../storage/journal/index.js";
import {
  checkpoints,
  compare,
  gitText,
  listBranches,
  snapshotRepository,
} from "../storage/git/index.js";
import { assembleEvents, conversationTitle } from "../sessions/conversation.js";
import { registeredProjects, type ViewerProject } from "./registry.js";

export const VIEWER_PORT = 4319;
export const VIEWER_PROTOCOL = "orbit-local-viewer-v1";

function fail(status: number, message: string): never {
  throw new DomainError(status, message);
}

function page<T>(items: T[], url: URL): Page<T> {
  const raw = url.searchParams.get("cursor") ?? "0";
  if (!/^\d{1,10}$/.test(raw)) fail(400, "Invalid page cursor");
  const offset = Number(raw),
    limit = pageLimit(url);
  return {
    items: items.slice(offset, offset + limit),
    nextCursor: offset + limit < items.length ? String(offset + limit) : null,
  };
}

function pageLimit(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail(400, "Page limit must be between 1 and 100");
  return limit;
}

async function openProject(entry: ViewerProject) {
  const config = JSON.parse(
    await readFile(join(entry.root, ".orbit", "project.json"), "utf8"),
  );
  if (config.projectId !== entry.projectId)
    fail(
      409,
      "The registered directory now belongs to another project. Run orbit dashboard there again.",
    );
  const db = new SqliteDatabase(
    join(entry.root, ".orbit", "state", "journal.sqlite"),
    true,
  );
  try {
    db.raw.pragma("busy_timeout = 1500");
    db.raw.exec("BEGIN");
    const repo = new Repository(db);
    if (!(await repo.get<Project>(entry.projectId, "project", entry.projectId)))
      fail(404, "Local project history is unavailable");
    return { db, repo };
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function projectView(repo: Repository, projectId: string) {
  const project = await repo.get<Project>(projectId, "project", projectId);
  if (!project) fail(404, "Project not found");
  const rows = await repo.db.query<{ last: string | null }>(
    "SELECT MAX(COALESCE(json_extract(data,'$.occurredAt'),json_extract(data,'$.updatedAt'),json_extract(data,'$.endedAt'),json_extract(data,'$.startedAt'))) AS last FROM orbit_entities WHERE project_id=$1",
    [projectId],
  );
  return {
    ...project,
    owner: "local",
    updatedAt: rows[0]?.last ?? project.updatedAt,
  };
}

async function workstreamViews(repo: Repository, projectId: string) {
  const workstreams = await repo.list<Workstream>(projectId, "workstream");
  const rows = await repo.db.query<{ workstream: string; last: string }>(
    "SELECT json_extract(data,'$.workstreamId') AS workstream, MAX(json_extract(data,'$.occurredAt')) AS last FROM orbit_entities WHERE project_id=$1 AND kind='event' GROUP BY workstream",
    [projectId],
  );
  const latest = new Map(rows.map((row) => [row.workstream, row.last]));
  return Promise.all(
    workstreams.map(async (workstream) => {
      let title = workstream.title;
      if (
        workstream.titleSource === "automatic" ||
        /^(Untitled workstream|<environment_context>|\[Orbit capture)/.test(
          title,
        )
      ) {
        const sessions = await repo.list<Session>(
          projectId,
          "session",
          workstream.id,
        );
        for (const session of sessions) {
          const events = assembleEvents(
            await repo.list<UniversalEvent>(projectId, "event", session.id),
          );
          if (events.some((event) => event.payload.type === "user_message")) {
            title = conversationTitle(workstream, events);
            break;
          }
        }
      }
      const last = latest.get(workstream.id);
      return {
        ...workstream,
        title,
        updatedAt:
          last && last > workstream.updatedAt ? last : workstream.updatedAt,
      };
    }),
  );
}

async function eventsFor(
  repo: Repository,
  projectId: string,
  sessionId: string,
  url: URL,
) {
  if (!(await repo.get<Session>(projectId, "session", sessionId)))
    fail(404, "Session not found");
  const events = assembleEvents(
    await repo.list<UniversalEvent>(projectId, "event", sessionId),
  ).filter((event) => event.payload.type !== "runtime_context");
  const cursor = url.searchParams.get("cursor");
  const end =
    cursor === null
      ? events.length
      : events.findIndex((event) => event.id === cursor);
  if (end < 0)
    fail(
      400,
      "This event cursor is no longer available. Reload the conversation.",
    );
  const start = Math.max(0, end - pageLimit(url));
  return {
    items: events.slice(start, end),
    nextCursor: start > 0 ? events[start]!.id : null,
  };
}

async function search(repo: Repository, projectId: string, url: URL) {
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query || query.length > 200)
    fail(400, "Enter a search query between 1 and 200 characters");
  const sessions = await repo.list<Session>(projectId, "session");
  const workstreams = await workstreamViews(repo, projectId);
  const results: {
    id: string;
    sessionId: string;
    title: string;
    agent: string;
    snippet: string;
    occurredAt: string;
  }[] = [];
  for (const session of sessions.reverse()) {
    const events = assembleEvents(
      await repo.list<UniversalEvent>(projectId, "event", session.id),
    );
    for (const event of events.reverse()) {
      if (event.payload.type === "runtime_context") continue;
      const payload = event.payload;
      const text =
        "text" in payload
          ? payload.text
          : "output" in payload
            ? payload.output
            : JSON.stringify(payload);
      const index = text.toLowerCase().indexOf(query.toLowerCase());
      if (index < 0) continue;
      results.push({
        id: event.id,
        sessionId: session.id,
        title:
          workstreams.find((w) => w.id === session.workstreamId)?.title ??
          "Conversation",
        agent: session.agent,
        snippet: text.slice(Math.max(0, index - 80), index + 240),
        occurredAt: event.occurredAt,
      });
    }
  }
  return page(results, url);
}

async function api(url: URL) {
  const segments = url.pathname
    .slice("/api/v1/".length)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const entries = await registeredProjects();
  if (segments.length === 1 && segments[0] === "projects") {
    const items: (Project & { root: string })[] = [];
    const unavailable: { projectId: string; message: string }[] = [];
    for (const entry of entries) {
      try {
        const { db, repo } = await openProject(entry);
        try {
          items.push({
            ...(await projectView(repo, entry.projectId)),
            root: entry.root,
          });
        } finally {
          await db.close();
        }
      } catch (error) {
        unavailable.push({
          projectId: entry.projectId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ...page(items, url), unavailable };
  }
  if (segments[0] !== "projects") fail(404, "Route not found");
  const projectId = segments[1],
    entry = entries.find((item) => item.projectId === projectId);
  if (!entry || !projectId)
    fail(
      404,
      "Project not registered on this computer. Run orbit dashboard in its directory.",
    );
  const history = join(entry.root, ".orbit", "history");
  const resource = segments[2];
  if (segments.length === 3 && resource === "checkpoints") {
    const raw = url.searchParams.get("cursor") ?? "0";
    if (!/^\d{1,10}$/.test(raw)) fail(400, "Invalid checkpoint cursor");
    const limit = pageLimit(url);
    const items = await checkpoints(
      history,
      url.searchParams.get("revision") ?? "HEAD",
      limit + 1,
      Number(raw),
    );
    return {
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? String(Number(raw) + limit) : null,
    };
  }
  if (segments.length === 3 && resource === "compare") {
    const from = url.searchParams.get("from"),
      to = url.searchParams.get("to");
    if (!from || !to) fail(400, "Choose two checkpoints to compare");
    return compare(history, from, to);
  }
  const live = await openProject(entry);
  let view: Awaited<ReturnType<typeof snapshotRepository>> | undefined;
  try {
    const revision = url.searchParams.get("revision");
    if (
      revision &&
      revision !== "HEAD" &&
      revision !== (await gitText(history, ["symbolic-ref", "--short", "HEAD"]))
    ) {
      view = await snapshotRepository(history, revision);
      if (view.snapshot.project.id !== projectId)
        fail(404, "Checkpoint belongs to another project");
    }
    const repo = view?.repo ?? live.repo;
    if (segments.length === 2)
      return { ...(await projectView(repo, projectId)), root: entry.root };
    if (segments.length === 3 && resource === "status") {
      const branch = await gitText(history, [
        "symbolic-ref",
        "--short",
        "HEAD",
      ]);
      const head = await live.repo.state("git:head");
      const count = await live.db.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM orbit_outbox",
      );
      return {
        head,
        branch,
        branches: await listBranches(history),
        uncheckpointed: count[0]?.n ?? 0,
        unpushed: 0,
        publishing: { enabled: false, lastSuccess: null, error: null },
        mode: "local",
        indexedRevision: view?.snapshot.revision ?? head,
      };
    }
    if (segments.length === 3 && resource === "workstreams")
      return page(await workstreamViews(repo, projectId), url);
    if (segments.length === 3 && resource === "sessions")
      return page(await repo.list<Session>(projectId, "session"), url);
    if (segments.length === 3 && resource === "search")
      return await search(repo, projectId, url);
    if (
      segments.length === 5 &&
      resource === "sessions" &&
      segments[4] === "events"
    )
      return await eventsFor(repo, projectId, segments[3]!, url);
    if (
      segments.length === 4 &&
      ["sessions", "workstreams"].includes(resource ?? "")
    ) {
      const kind: EntityKind =
        resource === "sessions" ? "session" : "workstream";
      const entity = await repo.get<Entity>(projectId, kind, segments[3]!);
      if (!entity) fail(404, "Conversation not found");
      return entity;
    }
    fail(404, "Route not found");
  } finally {
    if (view) await view.db.close();
    await live.db.close();
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function allowedRequest(request: IncomingMessage, port: number) {
  const host = request.headers.host;
  if (host !== "127.0.0.1:" + port && host !== "localhost:" + port)
    return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  if (request.headers.origin && request.headers.origin !== "http://" + host)
    return false;
  return true;
}

export async function startViewer(
  options: { port?: number; assets?: string } = {},
): Promise<Server> {
  // startViewer is bundled into dist/orbit.js; tests may supply an asset directory.
  const assets =
    options.assets ?? fileURLToPath(new URL("./ui/", import.meta.url));
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      const address = server.address();
      if (!address || typeof address === "string") return;
      if (!allowedRequest(request, address.port))
        return json(response, 403, {
          message: "This viewer accepts same-origin localhost requests only.",
        });
      const url = new URL(request.url ?? "/", "http://" + request.headers.host);
      if (url.pathname === "/api/v1/viewer/stop" && request.method === "POST") {
        if (request.headers.origin !== "http://" + request.headers.host)
          return json(response, 403, {
            message: "Same-origin request required",
          });
        json(response, 200, { stopped: true });
        server.close();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return json(response, 405, {
          message:
            "The local dashboard is read only. Use the Orbit CLI to change history.",
        });
      if (url.pathname === "/api/v1/viewer/health")
        return json(response, 200, { service: VIEWER_PROTOCOL });
      if (url.pathname.startsWith("/api/"))
        return json(response, 200, await api(url));
      const path = decodeURIComponent(url.pathname);
      const assetRoot = resolve(assets);
      let file = resolve(assetRoot, "." + path);
      if (file !== assetRoot && !file.startsWith(assetRoot + sep))
        return json(response, 403, { message: "Invalid asset path" });
      if (!extname(path)) file = join(assetRoot, "index.html");
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".txt": "text/plain; charset=utf-8",
      };
      const type = types[extname(file)];
      if (!type) return json(response, 404, { message: "Asset not found" });
      const body = await readFile(file).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT")
            fail(
              404,
              "Dashboard asset is missing. Reinstall Orbit or run npm run build from source.",
            );
          throw error;
        },
      );
      response.writeHead(200, { "Content-Type": type });
      response.end(request.method === "HEAD" ? undefined : body);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      json(response, error instanceof DomainError ? error.statusCode : 500, {
        message:
          error instanceof Error
            ? error.message
            : "Could not read local history",
      });
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? VIEWER_PORT, "127.0.0.1", () => {
      server.off("error", reject);
      ready();
    });
  });
  return server;
}
