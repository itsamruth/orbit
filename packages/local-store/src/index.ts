import type { Session, UniversalEvent, Workstream } from "@orbit/core";

/** Implement with SQLite. Event insert + outbox insert must share one transaction. */
export interface LocalStore {
  createWorkstream(workstream: Workstream): Promise<void>;
  createSession(session: Session): Promise<void>;
  append(events: UniversalEvent[]): Promise<void>;
  recentEvents(
    projectId: string,
    workstreamId: string,
    limit: number,
  ): Promise<UniversalEvent[]>;
  pendingEvents(projectId: string, limit: number): Promise<UniversalEvent[]>;
  acknowledge(projectId: string, eventIds: string[]): Promise<void>;
  close(): Promise<void>;
}

export * from "./database.js";
export * from "./repository.js";
