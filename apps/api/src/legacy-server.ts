import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { Repository, DomainError, type SqlDatabase } from "@orbit/local-store";
import {
  ProjectInput,
  ProjectPatch,
  SyncSchema,
  type Project,
  type Change,
  type EntityKind,
  type Entity,
} from "@orbit/contracts";
import { registerAuth, type AuthConfig } from "./auth.js";
export async function buildServer(db: SqlDatabase, config: AuthConfig) {
  const app = Fastify({ bodyLimit: 1024 * 1024, logger: false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: 60000 });
  if (process.env.ORBIT_TELEMETRY === "1")
    app.addHook("onResponse", async (req, reply) => {
      console.log(
        JSON.stringify({
          method: req.method,
          route: req.routeOptions.url ?? "unmatched",
          status: reply.statusCode,
          elapsedMs: Math.round(reply.elapsedTime),
        }),
      );
    });
  const repo = new Repository(db);
  const account = await registerAuth(app, db, config);
  app.setErrorHandler((error, _req, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({
      error: status >= 500 ? "server_error" : "request_failed",
      message:
        status >= 500
          ? "Orbit could not complete this request."
          : error instanceof Error
            ? error.message
            : "Invalid request",
    });
  });
  app.get("/health", async () => ({ status: "ok", service: "orbit-api" }));
  app.get("/ready", async () => {
    await db.query("SELECT 1");
    return { status: "ok" };
  });
  async function owner(req: import("fastify").FastifyRequest) {
    const user = await account(req);
    const id = (req.params as { id: string }).id;
    const owned = await db.query(
      "SELECT project_id FROM orbit_owners WHERE project_id=$1 AND user_id=$2",
      [id, user.id],
    );
    if (!owned.length) throw new DomainError(404, "Project not found");
    return { user, id };
  }
  app.get("/api/v1/projects", async (req) => {
    const user = await account(req);
    const rows = await db.query<{ data: string }>(
      "SELECT e.data FROM orbit_entities e JOIN orbit_owners o ON o.project_id=e.project_id WHERE o.user_id=$1 AND e.kind=$2 ORDER BY e.ordinal DESC,e.id",
      [user.id, "project"],
    );
    return { items: rows.map((r) => JSON.parse(r.data)), nextCursor: null };
  });
  app.post(
    "/api/v1/projects",
    { schema: { body: ProjectInput } },
    async (req) => {
      const user = await account(req);
      const body = req.body as {
        id: string;
        name: string;
        description?: string;
        repository?: string | null;
      };
      const now = new Date().toISOString();
      const repository = body.repository ?? null;
      if (
        repository &&
        (/[:\/]\/[^/]*@/.test(repository) || /[?\x00-\x1f]/.test(repository))
      )
        throw new DomainError(
          400,
          "Repository must not contain credentials or query parameters",
        );
      const p: Project = {
        id: body.id,
        name: body.name,
        description: body.description ?? "",
        repository,
        owner: user.login,
        createdAt: now,
        updatedAt: now,
        cloudSyncEnabled: true,
        excludedPaths: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key"],
      };
      return db.transaction(async (tx) => {
        const rows = await tx.query<{ user_id: string }>(
          "SELECT user_id FROM orbit_owners WHERE project_id=$1",
          [p.id],
        );
        if (rows[0]) {
          if (rows[0].user_id !== user.id)
            throw new DomainError(409, "Project identity already registered");
          const existing = await repo.get(p.id, "project", p.id, tx);
          if (!existing) throw new DomainError(410, "Project was deleted");
          return existing;
        }
        await tx.query(
          "INSERT INTO orbit_owners (project_id,user_id) VALUES ($1,$2)",
          [p.id, user.id],
        );
        await repo.apply(
          p.id,
          {
            id: "op_" + randomUUID(),
            kind: "project",
            entityId: p.id,
            action: "put",
            data: p,
          },
          tx,
          { cloud: true },
        );
        return p;
      });
    },
  );
  app.get("/api/v1/projects/:id", async (req) => {
    const { id } = await owner(req);
    const p = await repo.get(id, "project", id);
    if (!p) throw new DomainError(410, "Project was deleted");
    return p;
  });
  app.patch(
    "/api/v1/projects/:id",
    { schema: { body: ProjectPatch } },
    async (req) => {
      const { id } = await owner(req);
      return db.transaction(async (tx) => {
        const p = await repo.get<Project>(id, "project", id, tx);
        if (!p) throw new DomainError(410, "Project was deleted");
        const next = {
          ...p,
          ...(req.body as object),
          updatedAt: new Date().toISOString(),
        };
        await repo.apply(
          id,
          {
            id: "op_" + randomUUID(),
            kind: "project",
            entityId: id,
            action: "put",
            data: next,
          },
          tx,
          { cloud: true },
        );
        return next;
      });
    },
  );
  for (const [collection, kind] of [
    ["workstreams", "workstream"],
    ["sessions", "session"],
  ] as const) {
    app.get("/api/v1/projects/:id/" + collection, async (req) => {
      const { id } = await owner(req);
      return repo.page(
        id,
        kind,
        undefined,
        (req.query as { cursor?: string }).cursor ?? null,
        100,
      );
    });
    app.get(
      "/api/v1/projects/:id/" + collection + "/:entityId",
      async (req) => {
        const { id } = await owner(req);
        const entity = await repo.get(
          id,
          kind,
          (req.params as { entityId: string }).entityId,
        );
        if (!entity) throw new DomainError(404, "History not found");
        return entity;
      },
    );
  }
  app.patch(
    "/api/v1/projects/:id/workstreams/:entityId",
    {
      schema: {
        body: Type.Object(
          { title: Type.String({ minLength: 1, maxLength: 200 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      const { id } = await owner(req);
      return db.transaction(async (tx) => {
        const entityId = (req.params as { entityId: string }).entityId;
        const w = await repo.get(id, "workstream", entityId, tx);
        if (!w) throw new DomainError(404, "Workstream not found");
        const next = {
          ...w,
          ...(req.body as object),
          updatedAt: new Date().toISOString(),
        };
        await repo.apply(
          id,
          {
            id: "op_" + randomUUID(),
            kind: "workstream",
            entityId,
            action: "put",
            data: next,
          },
          tx,
          { cloud: true },
        );
        return next;
      });
    },
  );
  app.get("/api/v1/projects/:id/sessions/:sessionId/events", async (req) => {
    const { id } = await owner(req);
    const sessionId = (req.params as { sessionId: string }).sessionId;
    if (!(await repo.get(id, "session", sessionId)))
      throw new DomainError(404, "Session not found");
    return repo.page(
      id,
      "event",
      sessionId,
      (req.query as { cursor?: string }).cursor ?? null,
    );
  });
  for (const [suffix, kind] of [
    ["", "project"],
    ["/workstreams/:entityId", "workstream"],
    ["/sessions/:entityId", "session"],
  ] as const) {
    app.delete("/api/v1/projects/:id" + suffix, async (req) => {
      const { id } = await owner(req);
      const entityId =
        kind === "project" ? id : (req.params as { entityId: string }).entityId;
      await db.transaction((tx) =>
        repo.apply(
          id,
          {
            id: "op_" + randomUUID(),
            kind,
            entityId,
            action: "delete",
            data: null,
          },
          tx,
          { cloud: true },
        ),
      );
      return { ok: true };
    });
  }
  app.post(
    "/api/v1/projects/:id/sync",
    { schema: { body: SyncSchema } },
    async (req) => {
      const { id, user } = await owner(req);
      const body = req.body as { changes: Change[]; cursor: string | null };
      const cursor = Number(body.cursor ?? 0);
      if (!Number.isSafeInteger(cursor))
        throw new DomainError(400, "Invalid cursor");
      return db.transaction(async (tx) => {
        const acceptedIds: string[] = [],
          rejectedIds: string[] = [];
        const p = await repo.get<Project>(id, "project", id, tx);
        for (const change of body.changes) {
          if (change.kind === "project" && change.action === "put")
            throw new DomainError(400, "Use the project settings endpoint");
          if (p && !p.cloudSyncEnabled && change.action === "put")
            throw new DomainError(409, "Cloud sync is paused");
          try {
            await repo.apply(id, change, tx, { cloud: true });
            acceptedIds.push(change.id);
          } catch (e) {
            if (e instanceof DomainError && e.statusCode === 410) {
              rejectedIds.push(change.id);
            } else throw e;
          }
        }
        if (acceptedIds.length && p) {
          const latest = await repo.get<Project>(id, "project", id, tx);
          if (latest) {
            latest.updatedAt = new Date().toISOString();
            await repo.apply(
              id,
              {
                id: "op_" + randomUUID(),
                kind: "project",
                entityId: id,
                action: "put",
                data: latest,
              },
              tx,
              { cloud: true },
            );
          }
        }
        const rows = await tx.query<{ cursor: string | number; data: string }>(
          "SELECT cursor,data FROM orbit_changes WHERE project_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 101",
          [id, cursor],
        );
        const page = rows.slice(0, 100);
        return {
          acceptedIds,
          rejectedIds,
          changes: page.map((r) => JSON.parse(r.data)),
          nextCursor: String(page.at(-1)?.cursor ?? cursor),
          hasMore: rows.length > 100,
        };
      });
    },
  );
  return app;
}
