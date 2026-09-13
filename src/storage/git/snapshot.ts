import { createHash } from "node:crypto";
import type {
  Entity,
  EntityKind,
  Project,
  Session,
  UniversalEvent,
} from "../../protocol/index.js";
import {
  DomainError,
  fingerprint,
  Repository,
  SqliteDatabase,
  validateEntity,
} from "../journal/index.js";
import { git, resolveRevision } from "./git.js";

export interface Snapshot {
  project: Project;
  records: { kind: EntityKind; data: Entity }[];
  revision: string;
}
export async function readSnapshot(
  path: string,
  ref = "HEAD",
): Promise<Snapshot> {
  const revision = await resolveRevision(path, ref);
  const entries = (await git(path, ["ls-tree", "-r", "-z", revision]))
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, name] = line.split("\t");
      const [mode, type, oid] = meta!.split(" ");
      if (
        mode !== "100644" ||
        type !== "blob" ||
        !name ||
        !/^(orbit\.json|(?:workstreams|sessions|summarys)\/[a-zA-Z0-9_-]+\.json|events\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}\.jsonl)$/.test(
          name,
        )
      )
        throw new DomainError(400, "Unsupported repository entry: " + name);
      return { name, oid: oid! };
    });
  if (!entries.length || entries.length > 100000)
    throw new DomainError(400, "Repository entry limit exceeded");
  const result = await git(path, ["cat-file", "--batch"], {
    input: entries.map((e) => e.oid).join("\n") + "\n",
  });
  const files = new Map<string, string>();
  let offset = 0;
  for (const entry of entries) {
    const nl = result.indexOf(10, offset);
    const [oid, type, count] = result
      .subarray(offset, nl)
      .toString()
      .split(" ");
    const length = Number(count);
    if (
      oid !== entry.oid ||
      type !== "blob" ||
      !Number.isSafeInteger(length) ||
      length > 1024 * 1024
    )
      throw new DomainError(400, "Invalid or oversized conversation blob");
    const body = result.subarray(nl + 1, nl + 1 + length).toString();
    files.set(entry.name, body);
    offset = nl + 1 + length + 1;
  }
  const manifest = JSON.parse(files.get("orbit.json") ?? "null");
  if (![1, 2].includes(manifest?.formatVersion) || !manifest.project)
    throw new DomainError(400, "Unsupported Orbit repository format");
  const project = manifest.project as Project;
  validateEntity("project", project, project.id);
  const records: Snapshot["records"] = [{ kind: "project", data: project }];
  const seen = new Set([project.id]),
    sessions = new Map<string, Session>(),
    works = new Set<string>(),
    seqs = new Set<string>();
  for (const kind of ["workstream", "session", "event", "summary"] as const) {
    for (const [name, body] of files) {
      if (!name.startsWith(kind === "event" ? "events/" : kind + "s/"))
        continue;
      if (
        kind === "event" &&
        !name.endsWith(
          createHash("sha256").update(body).digest("hex") + ".jsonl",
        )
      )
        throw new DomainError(400, "Event chunk hash mismatch");
      const values =
        kind === "event"
          ? body
              .trimEnd()
              .split("\n")
              .map((s) => JSON.parse(s))
          : [JSON.parse(body)];
      for (const data of values) {
        validateEntity(kind, data, project.id);
        if (seen.has(data.id))
          throw new DomainError(400, "Duplicate entity ID");
        seen.add(data.id);
        if (kind !== "event" && name !== kind + "s/" + data.id + ".json")
          throw new DomainError(400, "Entity path mismatch");
        if (kind === "workstream") works.add(data.id);
        if (kind === "session") {
          const s = data as Session;
          if (!works.has(s.workstreamId))
            throw new DomainError(400, "Missing workstream");
          sessions.set(s.id, s);
        }
        if (kind === "event") {
          const e = data as UniversalEvent,
            s = sessions.get(e.sessionId);
          if (
            !s ||
            s.workstreamId !== e.workstreamId ||
            !name.startsWith("events/" + e.sessionId + "/")
          )
            throw new DomainError(400, "Invalid event parent");
          const key = e.sessionId + ":" + e.sequence;
          if (seqs.has(key))
            throw new DomainError(400, "Duplicate event sequence");
          seqs.add(key);
        }
        if (kind === "summary") {
          const summary =
            data as import("../../domain/index.js").SessionSummary;
          const session = sessions.get(summary.sessionId);
          if (!session || session.workstreamId !== summary.workstreamId)
            throw new DomainError(400, "Invalid summary parent");
        }
        records.push({ kind, data });
      }
    }
  }
  records.sort((a, b) => {
    const rank = {
      project: 0,
      workstream: 1,
      session: 2,
      event: 3,
      summary: 4,
    };
    if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
    if (a.kind === "event") {
      const x = a.data as UniversalEvent,
        y = b.data as UniversalEvent;
      return x.sessionId.localeCompare(y.sessionId) || x.sequence - y.sequence;
    }
    const date = (x: Entity) =>
      "startedAt" in x ? x.startedAt : "createdAt" in x ? x.createdAt : "";
    return (
      date(a.data).localeCompare(date(b.data)) ||
      a.data.id.localeCompare(b.data.id)
    );
  });
  return { project, records, revision };
}
export async function loadSnapshot(repo: Repository, snapshot: Snapshot) {
  await repo.db.transaction(async (db) => {
    for (const table of [
      "orbit_entities",
      "orbit_tombstones",
      "orbit_receipts",
      "orbit_outbox",
    ])
      await db.query("DELETE FROM " + table);
    for (const { kind, data } of snapshot.records)
      await repo.apply(
        snapshot.project.id,
        { id: "load_" + data.id, kind, entityId: data.id, action: "put", data },
        db,
      );
    await repo.setState("git:head", snapshot.revision, db);
  });
}
export async function snapshotRepository(path: string, ref = "HEAD") {
  const snapshot = await readSnapshot(path, ref);
  const db = new SqliteDatabase(":memory:"),
    repo = new Repository(db);
  try {
    await loadSnapshot(repo, snapshot);
    return { snapshot, repo, db };
  } catch (e) {
    await db.close();
    throw e;
  }
}
export async function compare(path: string, from: string, to: string) {
  const a = await readSnapshot(path, from),
    b = await readSnapshot(path, to);
  const left = new Map(a.records.map((x) => [x.data.id, x])),
    right = new Map(b.records.map((x) => [x.data.id, x]));
  return {
    from: a.revision,
    to: b.revision,
    changes: [...new Set([...left.keys(), ...right.keys()])].flatMap((id) => {
      const before = left.get(id),
        after = right.get(id);
      if (
        fingerprint(before?.data ?? null) === fingerprint(after?.data ?? null)
      )
        return [];
      return [
        {
          id,
          kind: (after ?? before)!.kind,
          action: !before ? "added" : !after ? "removed" : "changed",
          before: before?.data ?? null,
          after: after?.data ?? null,
        },
      ];
    }),
  };
}
