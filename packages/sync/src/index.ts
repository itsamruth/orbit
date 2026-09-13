import type { Change, Project } from "@orbit/contracts";
import { Repository, DomainError } from "@orbit/local-store";
export interface SyncResponse {
  acceptedIds: string[];
  rejectedIds: string[];
  changes: Change[];
  nextCursor: string;
  hasMore: boolean;
}
export interface SyncTransport {
  exchange(
    projectId: string,
    changes: Change[],
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<SyncResponse>;
}
export class HttpSyncTransport implements SyncTransport {
  constructor(
    private origin: string,
    private token: string,
  ) {}
  async exchange(
    projectId: string,
    changes: Change[],
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<SyncResponse> {
    const response = await fetch(
      this.origin +
        "/api/v1/projects/" +
        encodeURIComponent(projectId) +
        "/sync",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ changes, cursor }),
        signal,
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(
        body.message ?? "Cloud sync failed (" + response.status + ")",
      );
    }
    return (await response.json()) as SyncResponse;
  }
}
export class SyncWorker {
  private running: Promise<void> | null = null;
  constructor(
    private repo: Repository,
    private transport: SyncTransport,
    private projectId: string,
  ) {}
  flush(signal: AbortSignal = AbortSignal.timeout(30000)): Promise<void> {
    if (this.running) return this.running;
    this.running = this.perform(signal).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async perform(signal: AbortSignal) {
    let downloadOnly = true,
      more = true;
    while (more && !signal.aborted) {
      const p = await this.repo.get<Project>(
        this.projectId,
        "project",
        this.projectId,
      );
      const queued = await this.repo.pending(this.projectId);
      const pending: Change[] = [];
      let bytes = 128;
      if (!downloadOnly)
        for (const change of queued.filter(
          (c) => p?.cloudSyncEnabled || c.action === "delete",
        )) {
          const size = Buffer.byteLength(JSON.stringify(change));
          if (bytes + size > 900000) break;
          pending.push(change);
          bytes += size;
        }
      const cursor = await this.repo.state("cursor:" + this.projectId);
      const response = await this.transport.exchange(
        this.projectId,
        pending,
        cursor,
        signal,
      );
      if (
        !/^\d+$/.test(response.nextCursor) ||
        Number(response.nextCursor) < Number(cursor ?? 0)
      )
        throw new Error("Cloud returned an invalid synchronization cursor");
      await this.repo.db.transaction(async (db) => {
        for (const change of response.changes) {
          try {
            await this.repo.apply(this.projectId, change, db);
          } catch (e) {
            if (!(e instanceof DomainError && e.statusCode === 410)) throw e;
          }
        }
        const uploaded = new Set(pending.map((x) => x.id));
        await this.repo.ack(
          [...response.acceptedIds, ...response.rejectedIds].filter((id) =>
            uploaded.has(id),
          ),
          db,
        );
        // A tombstone invalidates old queued history, including descendants.
        const queued = await db.query<{ id: string; data: string }>(
          "SELECT id,data FROM orbit_outbox WHERE project_id=$1",
          [this.projectId],
        );
        for (const row of queued) {
          const c = JSON.parse(row.data) as Change;
          if (c.action !== "put") continue;
          const entity = c.data;
          const ids = [
            this.projectId,
            c.entityId,
            ...(entity && "workstreamId" in entity
              ? [entity.workstreamId]
              : []),
            ...(entity && "sessionId" in entity ? [entity.sessionId] : []),
          ];
          let dead = false;
          for (const id of ids) {
            if (
              (
                await db.query(
                  "SELECT id FROM orbit_tombstones WHERE id=$1 AND project_id=$2",
                  [id, this.projectId],
                )
              ).length
            )
              dead = true;
          }
          if (dead) await this.repo.ack([row.id], db);
        }
        await this.repo.setState(
          "cursor:" + this.projectId,
          response.nextCursor,
          db,
        );
        await this.repo.setState(
          "lastSync:" + this.projectId,
          new Date().toISOString(),
          db,
        );
      });
      const current = await this.repo.get<Project>(
        this.projectId,
        "project",
        this.projectId,
      );
      more =
        response.hasMore ||
        (await this.repo.pending(this.projectId)).some(
          (c) => current?.cloudSyncEnabled || c.action === "delete",
        );
      if (
        pending.length &&
        !response.acceptedIds.length &&
        !response.rejectedIds.length &&
        !response.hasMore
      )
        throw new Error("Cloud made no progress acknowledging pending history");
      downloadOnly = response.hasMore;
    }
    if (signal.aborted) throw signal.reason;
  }
  async run(signal: AbortSignal, onError: (e: unknown) => void = () => {}) {
    let delay = 2000;
    while (!signal.aborted) {
      try {
        await this.flush(AbortSignal.any([signal, AbortSignal.timeout(30000)]));
        delay = 2000;
      } catch (e) {
        if (!signal.aborted) onError(e);
        delay = Math.min(delay * 2, 60000);
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, delay);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  }
}
