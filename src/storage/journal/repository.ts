import { createHash, randomUUID } from "node:crypto";
import type {
  Change,
  Entity,
  EntityKind,
  Page,
  UniversalEvent,
} from "../../protocol/index.js";
import type { SqlConnection, SqlDatabase } from "./database.js";
export class DomainError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
export const fingerprint = (v: unknown) =>
  createHash("sha256").update(json(v)).digest("hex");
const fail = (message: string): never => {
  throw new DomainError(400, message);
};
const text = (o: Record<string, unknown>, key: string, max = 1000) => {
  if (
    typeof o[key] !== "string" ||
    !(o[key] as string).length ||
    (o[key] as string).length > max
  )
    fail("Invalid " + key);
};
const id = (o: Record<string, unknown>, key: string) => {
  text(o, key, 160);
  if (!/^[a-zA-Z0-9_-]+$/.test(o[key] as string)) fail("Invalid " + key);
};
export function validateEntity(
  kind: EntityKind,
  value: unknown,
  projectId: string,
): asserts value is Entity {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Invalid entity");
  const o = value as Record<string, unknown>;
  id(o, "id");
  const fields: Record<EntityKind, string[]> = {
    project: [
      "id",
      "name",
      "description",
      "repository",
      "owner",
      "createdAt",
      "updatedAt",
      "cloudSyncEnabled",
      "excludedPaths",
    ],
    workstream: [
      "id",
      "projectId",
      "title",
      "branch",
      "createdAt",
      "updatedAt",
    ],
    session: [
      "id",
      "projectId",
      "workstreamId",
      "agent",
      "nativeSessionId",
      "origin",
      "status",
      "startedAt",
      "endedAt",
      "captureMode",
      "importedAt",
      "sourceFingerprint",
    ],
    event: [
      "schemaVersion",
      "id",
      "projectId",
      "workstreamId",
      "sessionId",
      "sequence",
      "occurredAt",
      "payload",
    ],
    summary: [
      "schemaVersion",
      "id",
      "projectId",
      "workstreamId",
      "sessionId",
      "provider",
      "providerVersion",
      "model",
      "promptVersion",
      "sourceHash",
      "generatedAt",
      "coverage",
      "title",
      "overview",
      "objectives",
      "decisions",
      "rejectedApproaches",
      "openQuestions",
      "tasks",
      "files",
    ],
  };
  if (Object.keys(o).some((key) => !fields[kind].includes(key)))
    fail("Unexpected entity field");
  const timestamp = (key: string) => {
    if (
      typeof o[key] !== "string" ||
      !Number.isFinite(Date.parse(o[key] as string))
    )
      fail("Invalid " + key);
  };
  if (kind === "project" || kind === "workstream") {
    timestamp("createdAt");
    timestamp("updatedAt");
  }
  if (kind === "session") {
    timestamp("startedAt");
    if (o.endedAt !== null) timestamp("endedAt");
  }
  if (kind === "event") timestamp("occurredAt");
  if (kind === "project") {
    if (o.id !== projectId) fail("Project mismatch");
    text(o, "name", 120);
    text(o, "owner", 120);
    if (
      typeof o.description !== "string" ||
      o.description.length > 2000 ||
      typeof o.cloudSyncEnabled !== "boolean" ||
      !Array.isArray(o.excludedPaths) ||
      o.excludedPaths.length > 100 ||
      !o.excludedPaths.every((x) => typeof x === "string" && x.length <= 300)
    )
      fail("Invalid project settings");
  } else {
    if (o.projectId !== projectId) fail("Project mismatch");
  }
  if (kind === "workstream") {
    text(o, "title", 200);
    if (o.branch !== null && typeof o.branch !== "string")
      fail("Invalid branch");
  }
  if (kind === "session") {
    id(o, "workstreamId");
    text(o, "nativeSessionId", 200);
    if (o.origin !== undefined) {
      const origin = o.origin as Record<string, unknown>;
      if (
        !origin ||
        typeof origin !== "object" ||
        typeof origin.checkpoint !== "string" ||
        !/^[a-f0-9]{40,64}$/.test(origin.checkpoint)
      )
        fail("Invalid continuation origin");
      id(origin, "workstreamId");
    }
    text(o, "agent", 100);
    text(o, "startedAt", 100);
    if (
      !["active", "paused", "ended", "interrupted"].includes(o.status as string)
    )
      fail("Invalid session status");
    if (
      o.captureMode !== undefined &&
      !["live", "imported"].includes(o.captureMode as string)
    )
      fail("Invalid capture mode");
    if (o.importedAt !== undefined) timestamp("importedAt");
    if (
      o.sourceFingerprint !== undefined &&
      (typeof o.sourceFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(o.sourceFingerprint))
    )
      fail("Invalid source fingerprint");
  }
  if (kind === "event") {
    id(o, "workstreamId");
    id(o, "sessionId");
    if (
      o.schemaVersion !== 1 ||
      !Number.isSafeInteger(o.sequence) ||
      (o.sequence as number) < 0
    )
      fail("Invalid event sequence or schema");
    text(o, "occurredAt", 100);
    const p = o.payload as Record<string, unknown>;
    if (!p || typeof p !== "object") fail("Invalid event payload");
    const payloadFields: Record<string, string[]> = {
      user_message: ["type", "text"],
      assistant_message: ["type", "text"],
      tool_call: ["type", "callId", "name", "input"],
      tool_result: ["type", "callId", "output", "failed"],
      command: ["type", "command", "exitCode"],
      file_modified: ["type", "path"],
      git_state: ["type", "workspace"],
      session_ended: ["type", "reason"],
    };
    if (
      !payloadFields[String(p.type)] ||
      Object.keys(p).some(
        (key) => !payloadFields[String(p.type)]!.includes(key),
      )
    )
      fail("Unsupported event fields");
    switch (p.type) {
      case "user_message":
      case "assistant_message":
        if (typeof p.text !== "string") fail("Invalid message");
        break;
      case "tool_call":
        text(p, "callId", 200);
        text(p, "name", 200);
        if (!("input" in p)) fail("Missing tool input");
        break;
      case "tool_result":
        text(p, "callId", 200);
        if (typeof p.output !== "string" || typeof p.failed !== "boolean")
          fail("Invalid tool result");
        break;
      case "command":
        text(p, "command", 200000);
        if (p.exitCode !== null && !Number.isInteger(p.exitCode))
          fail("Invalid exit code");
        break;
      case "file_modified":
        text(p, "path", 10000);
        break;
      case "git_state": {
        const w = p.workspace as Record<string, unknown>;
        if (
          !w ||
          typeof w.root !== "string" ||
          typeof w.porcelain !== "string" ||
          typeof w.dirty !== "boolean" ||
          (w.branch !== null && typeof w.branch !== "string") ||
          (w.head !== null && typeof w.head !== "string")
        )
          fail("Invalid workspace");
        break;
      }
      case "session_ended":
        text(p, "reason", 1000);
        break;
      default:
        fail("Unsupported event type");
    }
  }
  if (kind === "summary") {
    id(o, "workstreamId");
    id(o, "sessionId");
    if (
      o.schemaVersion !== 1 ||
      !["codex", "claude"].includes(o.provider as string) ||
      !Number.isSafeInteger(o.promptVersion) ||
      (o.promptVersion as number) < 1 ||
      typeof o.sourceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(o.sourceHash) ||
      !["complete", "truncated"].includes(o.coverage as string)
    )
      fail("Invalid summary metadata");
    timestamp("generatedAt");
    text(o, "providerVersion", 200);
    text(o, "title", 200);
    text(o, "overview", 20000);
    if (o.model !== null && typeof o.model !== "string")
      fail("Invalid summary model");
    for (const key of ["objectives", "files"])
      if (
        !Array.isArray(o[key]) ||
        !(o[key] as unknown[]).every(
          (x) => typeof x === "string" && x.length <= 10000,
        )
      )
        fail("Invalid summary " + key);
    for (const key of [
      "decisions",
      "rejectedApproaches",
      "openQuestions",
      "tasks",
    ]) {
      if (!Array.isArray(o[key])) fail("Invalid summary " + key);
      for (const item of o[key] as Record<string, unknown>[]) {
        if (
          !item ||
          typeof item.text !== "string" ||
          !Array.isArray(item.evidenceEventIds) ||
          !item.evidenceEventIds.every(
            (x) => typeof x === "string" && /^[a-zA-Z0-9_-]+$/.test(x),
          ) ||
          (key === "tasks" && !["open", "done"].includes(item.status as string))
        )
          fail("Invalid summary item");
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 256000)
    fail("Entity exceeds 256 KB");
}
type Row = {
  id: string;
  project_id: string;
  kind: EntityKind;
  parent_id: string | null;
  ordinal: number;
  data: string;
};
export class Repository {
  constructor(readonly db: SqlDatabase) {}
  async get<T extends Entity>(
    projectId: string,
    kind: EntityKind,
    id: string,
    db: SqlConnection = this.db,
  ): Promise<T | null> {
    const rows = await db.query<Row>(
      "SELECT * FROM orbit_entities WHERE project_id=$1 AND kind=$2 AND id=$3",
      [projectId, kind, id],
    );
    return rows[0] ? (JSON.parse(rows[0].data) as T) : null;
  }
  async list<T extends Entity>(
    projectId: string,
    kind: EntityKind,
    parent?: string,
    db: SqlConnection = this.db,
  ): Promise<T[]> {
    const rows = await db.query<Row>(
      "SELECT * FROM orbit_entities WHERE project_id=$1 AND kind=$2" +
        (parent ? " AND parent_id=$3" : "") +
        " ORDER BY ordinal,id",
      parent ? [projectId, kind, parent] : [projectId, kind],
    );
    return rows.map((r) => JSON.parse(r.data) as T);
  }
  async page<T extends Entity>(
    projectId: string,
    kind: EntityKind,
    parent: string | undefined,
    cursor: string | null,
    limit = 50,
  ): Promise<Page<T>> {
    if (cursor !== null && !/^\d+$/.test(cursor))
      throw new DomainError(400, "Invalid cursor");
    const offset = Number(cursor ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new DomainError(400, "Invalid cursor");
    const values: unknown[] = [projectId, kind];
    let where = "project_id=$1 AND kind=$2";
    if (parent) {
      values.push(parent);
      where += " AND parent_id=$3";
    }
    const n = values.length;
    values.push(limit + 1, offset);
    const rows = await this.db.query<Row>(
      "SELECT * FROM orbit_entities WHERE " +
        where +
        " ORDER BY ordinal,id LIMIT $" +
        (n + 1) +
        " OFFSET $" +
        (n + 2),
      values,
    );
    return {
      items: rows.slice(0, limit).map((r) => JSON.parse(r.data) as T),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
  }
  async apply(
    projectId: string,
    change: Change,
    db: SqlConnection,
    {
      outbox = false,
      cloud = false,
    }: { outbox?: boolean; cloud?: boolean } = {},
  ): Promise<void> {
    const prior = await db.query<{ fingerprint: string; project_id: string }>(
      "SELECT fingerprint,project_id FROM orbit_receipts WHERE id=$1",
      [change.id],
    );
    const hash = fingerprint(change);
    if (prior[0]) {
      if (prior[0].project_id !== projectId || prior[0].fingerprint !== hash)
        throw new DomainError(409, "Operation ID already used");
      return;
    }
    if (change.action === "delete") {
      if (change.kind === "event")
        throw new DomainError(400, "Delete the containing session instead");
      const occupied = await db.query<Row>(
        "SELECT * FROM orbit_entities WHERE id=$1",
        [change.entityId],
      );
      if (
        occupied[0] &&
        (occupied[0].project_id !== projectId ||
          occupied[0].kind !== change.kind)
      )
        throw new DomainError(404, "History not found in this project");
      const target = await this.get(
        projectId,
        change.kind,
        change.entityId,
        db,
      );
      const ids = [change.entityId];
      if (target) {
        const descendants = await db.query<Row>(
          "SELECT * FROM orbit_entities WHERE project_id=$1",
          [projectId],
        );
        for (const row of descendants) {
          const data = JSON.parse(row.data);
          if (
            change.kind === "project" ||
            data.workstreamId === change.entityId ||
            data.sessionId === change.entityId
          )
            ids.push(row.id);
        }
      }
      const removed = new Set(ids);
      for (const row of await db.query<{ cursor: string; data: string }>(
        "SELECT cursor,data FROM orbit_changes WHERE project_id=$1",
        [projectId],
      )) {
        const prior = JSON.parse(row.data) as Change;
        if (removed.has(prior.entityId))
          await db.query("DELETE FROM orbit_changes WHERE cursor=$1", [
            row.cursor,
          ]);
      }
      for (const row of await db.query<{ id: string; data: string }>(
        "SELECT id,data FROM orbit_outbox WHERE project_id=$1",
        [projectId],
      )) {
        const queued = JSON.parse(row.data) as Change;
        const data = queued.data;
        if (
          removed.has(queued.entityId) ||
          (data && "workstreamId" in data && removed.has(data.workstreamId)) ||
          (data && "sessionId" in data && removed.has(data.sessionId))
        )
          await db.query("DELETE FROM orbit_outbox WHERE id=$1", [row.id]);
      }
      for (const entityId of removed) {
        await db.query(
          "INSERT INTO orbit_tombstones (id,project_id,kind) VALUES ($1,$2,$3) ON CONFLICT (project_id,id) DO NOTHING",
          [entityId, projectId, change.kind],
        );
        await db.query(
          "DELETE FROM orbit_entities WHERE id=$1 AND project_id=$2",
          [entityId, projectId],
        );
      }
    } else {
      validateEntity(change.kind, change.data, projectId);
      const data = change.data;
      if (data.id !== change.entityId)
        throw new DomainError(400, "Entity ID mismatch");
      const ancestors = [
        data.id,
        projectId,
        ...("workstreamId" in data ? [data.workstreamId] : []),
        ...("sessionId" in data ? [data.sessionId] : []),
      ];
      for (const ancestor of ancestors) {
        const dead = await db.query(
          "SELECT id FROM orbit_tombstones WHERE id=$1 AND project_id=$2",
          [ancestor, projectId],
        );
        if (dead.length)
          throw new DomainError(
            410,
            "History was deleted. Discard the pending operation.",
          );
      }
      if (
        change.kind !== "project" &&
        !(await this.get(projectId, "project", projectId, db))
      )
        throw new DomainError(409, "Project must be synchronized first");
      let parent: string | null = null;
      if ("workstreamId" in data) {
        const w = await this.get(
          projectId,
          "workstream",
          data.workstreamId,
          db,
        );
        if (!w)
          throw new DomainError(409, "Workstream must be synchronized first");
        parent = data.workstreamId;
      }
      if ("sessionId" in data) {
        const s = await this.get<import("../../domain/index.js").Session>(
          projectId,
          "session",
          data.sessionId,
          db,
        );
        if (!s || s.workstreamId !== data.workstreamId)
          throw new DomainError(409, "Session ownership mismatch");
        parent = data.sessionId;
      }
      const existing = await this.get(projectId, change.kind, data.id, db);
      const occupied = await db.query<Row>(
        "SELECT * FROM orbit_entities WHERE id=$1",
        [data.id],
      );
      if (
        occupied[0] &&
        (occupied[0].project_id !== projectId ||
          occupied[0].kind !== change.kind)
      )
        throw new DomainError(409, "Entity ID already used");
      if (
        existing &&
        change.kind === "event" &&
        fingerprint(existing) !== fingerprint(data)
      )
        throw new DomainError(409, "Event is immutable");
      if (
        existing &&
        "workstreamId" in existing &&
        "workstreamId" in data &&
        existing.workstreamId !== data.workstreamId
      )
        throw new DomainError(409, "Session parent is immutable");
      const order =
        "sequence" in data
          ? data.sequence
          : (occupied[0]?.ordinal ??
            Number(
              (
                await db.query<{ ordinal: number }>(
                  "SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM orbit_entities WHERE project_id=$1 AND kind=$2",
                  [projectId, change.kind],
                )
              )[0]!.ordinal,
            ));
      if (change.kind === "event") {
        const seq = await db.query<Row>(
          "SELECT * FROM orbit_entities WHERE project_id=$1 AND kind=$2 AND parent_id=$3 AND ordinal=$4",
          [projectId, "event", parent, order],
        );
        if (seq[0] && seq[0].id !== data.id)
          throw new DomainError(409, "Session sequence already used");
      }
      await db.query(
        "INSERT INTO orbit_entities (id,project_id,kind,parent_id,ordinal,data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET data=excluded.data",
        [data.id, projectId, change.kind, parent, order, json(data)],
      );
    }
    await db.query(
      "INSERT INTO orbit_receipts (id,project_id,fingerprint) VALUES ($1,$2,$3)",
      [change.id, projectId, hash],
    );
    if (outbox)
      await db.query(
        "INSERT INTO orbit_outbox (id,project_id,data) VALUES ($1,$2,$3)",
        [change.id, projectId, json(change)],
      );
    if (cloud)
      await db.query(
        "INSERT INTO orbit_changes (project_id,data) VALUES ($1,$2)",
        [projectId, json(change)],
      );
  }
  async put(projectId: string, kind: EntityKind, data: Entity, outbox = true) {
    const change: Change = {
      id: "op_" + randomUUID(),
      kind,
      entityId: data.id,
      action: "put",
      data,
    };
    await this.db.transaction((db) =>
      this.apply(projectId, change, db, { outbox }),
    );
  }
  async remove(projectId: string, kind: EntityKind, id: string, outbox = true) {
    const change: Change = {
      id: "op_" + randomUUID(),
      kind,
      entityId: id,
      action: "delete",
      data: null,
    };
    await this.db.transaction((db) =>
      this.apply(projectId, change, db, { outbox }),
    );
  }
  async handoffEvents(
    projectId: string,
    workstreamId: string,
  ): Promise<{ events: UniversalEvent[]; truncated: boolean }> {
    const base =
      "SELECT e.data,s.ordinal AS session_order,e.ordinal AS event_order FROM orbit_entities e JOIN orbit_entities s ON e.parent_id=s.id WHERE e.project_id=$1 AND e.kind=$2 AND s.parent_id=$3";
    const values = [projectId, "event", workstreamId];
    const recent = await this.db.query<{
      data: string;
      session_order: number;
      event_order: number;
    }>(base + " ORDER BY s.ordinal DESC,e.ordinal DESC LIMIT 256", values);
    const objectiveQuery = base + " AND e.data LIKE $4";
    const first = await this.db.query<{
      data: string;
      session_order: number;
      event_order: number;
    }>(objectiveQuery + " ORDER BY s.ordinal,e.ordinal LIMIT 1", [
      ...values,
      '%"type":"user_message"%',
    ]);
    const latest = await this.db.query<{
      data: string;
      session_order: number;
      event_order: number;
    }>(objectiveQuery + " ORDER BY s.ordinal DESC,e.ordinal DESC LIMIT 1", [
      ...values,
      '%"type":"user_message"%',
    ]);
    const sorted = [...first, ...recent, ...latest].sort(
      (a, b) =>
        Number(a.session_order) - Number(b.session_order) ||
        Number(a.event_order) - Number(b.event_order),
    );
    const events = [
      ...new Map(
        sorted.map((r) => {
          const e = JSON.parse(r.data) as UniversalEvent;
          return [e.id, e];
        }),
      ).values(),
    ];
    const total = await this.db.query<{ count: string | number }>(
      "SELECT COUNT(*) AS count FROM orbit_entities e JOIN orbit_entities s ON e.parent_id=s.id WHERE e.project_id=$1 AND e.kind=$2 AND s.parent_id=$3",
      values,
    );
    return { events, truncated: Number(total[0]?.count ?? 0) > events.length };
  }
  async state(key: string): Promise<string | null> {
    return (
      (
        await this.db.query<{ value: string }>(
          "SELECT value FROM orbit_state WHERE key=$1",
          [key],
        )
      )[0]?.value ?? null
    );
  }
  async setState(key: string, value: string, db: SqlConnection = this.db) {
    await db.query(
      "INSERT INTO orbit_state (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=excluded.value",
      [key, value],
    );
  }
  async pending(projectId: string): Promise<Change[]> {
    return (
      await this.db.query<{ data: string }>(
        "SELECT data FROM orbit_outbox WHERE project_id=$1 ORDER BY position LIMIT 100",
        [projectId],
      )
    ).map((r) => JSON.parse(r.data));
  }
  async ack(ids: string[], db: SqlConnection = this.db) {
    for (const id of ids)
      await db.query("DELETE FROM orbit_outbox WHERE id=$1", [id]);
  }
  async offset(source: string) {
    return Number(
      (
        await this.db.query<{ position: number }>(
          "SELECT position FROM orbit_offsets WHERE source=$1",
          [source],
        )
      )[0]?.position ?? 0,
    );
  }
  async capture(
    projectId: string,
    source: string,
    position: number,
    events: UniversalEvent[],
    state?: { key: string; value: string },
  ) {
    await this.db.transaction(async (db) => {
      for (const event of events)
        await this.apply(
          projectId,
          {
            id: "capture_" + event.id,
            kind: "event",
            entityId: event.id,
            action: "put",
            data: event,
          },
          db,
          { outbox: true },
        );
      if (state) await this.setState(state.key, state.value, db);
      await db.query(
        "INSERT INTO orbit_offsets (source,position) VALUES ($1,$2) ON CONFLICT (source) DO UPDATE SET position=excluded.position",
        [source, position],
      );
    });
  }
}
