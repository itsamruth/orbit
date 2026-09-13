import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Entity, EntityKind } from "../protocol/index.js";
import { GitRepository, readSnapshot } from "./git/index.js";
import {
  Repository,
  SqliteDatabase,
  fingerprint,
  validateEntity,
} from "./journal/index.js";
type RecordEntry = { kind: EntityKind; data: Entity };
export async function migrate(
  root: string,
  pid: string,
  dryRun: boolean,
  from?: string,
) {
  try {
    await access(join(root, ".orbit", "process.json"));
    throw new Error("Stop active capture before migration.");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  let db: SqliteDatabase | undefined,
    records: RecordEntry[] = [];
  try {
    if (from) {
      const exported = JSON.parse(await readFile(resolve(from), "utf8"));
      if (
        exported.format !== "orbit-legacy-export-v1" ||
        exported.projectId !== pid ||
        !Array.isArray(exported.records)
      )
        throw new Error("Invalid legacy export or project identity mismatch");
      records = exported.records;
    } else {
      const source = join(root, ".orbit", "history.sqlite");
      await access(source);
      db = new SqliteDatabase(source);
      const legacy = new Repository(db);
      for (const kind of ["project", "workstream", "session", "event"] as const)
        for (const data of await legacy.list(pid, kind))
          records.push({ kind, data });
    }
    for (const { kind, data } of records) {
      if (!["project", "workstream", "session", "event"].includes(kind))
        throw new Error("Invalid record kind");
      validateEntity(kind, data, pid);
    }
    if (records.filter((r) => r.kind === "project").length !== 1)
      throw new Error("Export must contain exactly one project");
    // Publishing preference is intentionally local in the new format.
    records = records.map((r) =>
      r.kind === "project"
        ? { ...r, data: { ...r.data, cloudSyncEnabled: false } as Entity }
        : r,
    );
    const digest = fingerprint(records),
      report = { records: records.length, digest, dryRun };
    if (dryRun) return report;
    await mkdir(join(root, ".orbit", "state"), {
      recursive: true,
      mode: 0o700,
    });
    const backup = join(
      root,
      ".orbit",
      "state",
      from ? "legacy-export.json" : "legacy-backup.sqlite",
    );
    try {
      await access(backup);
    } catch {
      if (db) await db.raw.backup(backup);
      else
        await writeFile(backup, await readFile(resolve(from!)), {
          mode: 0o600,
          flag: "wx",
        });
    }
    const repo = await GitRepository.open(root, true);
    try {
      await repo.assertIdle();
      const done = await repo.state("migration:digest");
      if (done === digest) return { ...report, alreadyMigrated: true };
      const existing = await repo.state("git:head");
      const intent = await repo.state("migration:intent");
      if (existing) {
        if (intent !== digest)
          throw new Error(
            "Git history already exists and differs from this import; use a separate destination.",
          );
        const actual = (await readSnapshot(repo.history)).records;
        const canonical = (items: RecordEntry[]) =>
          items.slice().sort((a, b) => a.data.id.localeCompare(b.data.id));
        if (fingerprint(canonical(actual)) !== fingerprint(canonical(records)))
          throw new Error("Interrupted import verification failed");
        await repo.setState("migration:digest", digest);
        return { ...report, alreadyMigrated: true };
      }
      await repo.setState("migration:intent", digest);
      for (const { kind, data } of records) await repo.put(pid, kind, data);
      const canonical = (items: RecordEntry[]) =>
        items.slice().sort((a, b) => a.data.id.localeCompare(b.data.id));
      const exported: RecordEntry[] = [];
      for (const kind of ["project", "workstream", "session", "event"] as const)
        for (const data of await repo.list(pid, kind))
          exported.push({ kind, data });
      if (fingerprint(canonical(exported)) !== fingerprint(canonical(records)))
        throw new Error("Migration content verification failed");
      const oid = await repo.checkpoint(
        "Import legacy Orbit history (original checkpoint boundaries unavailable)",
      );
      const snapshot = await readSnapshot(repo.history);
      if (
        fingerprint(canonical(snapshot.records)) !==
        fingerprint(canonical(records))
      )
        throw new Error(
          "Git snapshot verification failed; legacy backup remains available",
        );
      await repo.setState("migration:digest", digest);
      return { ...report, checkpoint: oid, backup };
    } finally {
      await repo.db.close();
    }
  } finally {
    await db?.close();
  }
}
