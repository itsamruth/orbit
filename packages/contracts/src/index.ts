import { Type, type Static } from "@sinclair/typebox";
import type {
  Session,
  SessionSummary,
  UniversalEvent,
  Workstream,
} from "@orbit/core";
export interface Project {
  id: string;
  name: string;
  description: string;
  repository: string | null;
  owner: string;
  createdAt: string;
  updatedAt: string;
  cloudSyncEnabled: boolean;
  excludedPaths: string[];
}
export interface Account {
  id: string;
  login: string;
  avatarUrl: string | null;
}
export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export type Entity =
  | Project
  | Workstream
  | Session
  | UniversalEvent
  | SessionSummary;
export type EntityKind =
  | "project"
  | "workstream"
  | "session"
  | "event"
  | "summary";
export interface Change {
  id: string;
  kind: EntityKind;
  entityId: string;
  action: "put" | "delete";
  data: Entity | null;
}
export interface SyncResult {
  acceptedIds: string[];
  changes: Change[];
  nextCursor: string;
  hasMore: boolean;
}
export const Id = Type.String({ pattern: "^[a-zA-Z0-9_-]{1,160}$" });
export const ChangeSchema = Type.Object(
  {
    id: Id,
    kind: Type.Union([
      Type.Literal("project"),
      Type.Literal("workstream"),
      Type.Literal("session"),
      Type.Literal("event"),
      Type.Literal("summary"),
    ]),
    entityId: Id,
    action: Type.Union([Type.Literal("put"), Type.Literal("delete")]),
    data: Type.Union([
      Type.Object({}, { additionalProperties: true }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const SyncSchema = Type.Object(
  {
    changes: Type.Array(ChangeSchema, { maxItems: 100 }),
    cursor: Type.Union([
      Type.String({ pattern: "^[0-9]{1,20}$" }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type SyncInput = Static<typeof SyncSchema>;
export const ProjectInput = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    repository: Type.Optional(
      Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
export const ProjectPatch = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    cloudSyncEnabled: Type.Optional(Type.Boolean()),
    excludedPaths: Type.Optional(
      Type.Array(Type.String({ maxLength: 300 }), { maxItems: 100 }),
    ),
  },
  { additionalProperties: false },
);
export type {
  EvidenceItem,
  Session,
  SessionSummary,
  SummaryTask,
  UniversalEvent,
  Workstream,
} from "@orbit/core";

export interface ImportCandidate {
  id: string;
  agent: "codex" | "claude";
  nativeSessionId: string;
  startedAt: string | null;
  updatedAt: string;
  firstPrompt: string | null;
  messageCount: number;
  branch: string | null;
  alreadyImported: boolean;
  importState: "new" | "updated" | "conflict" | "current";
}

export interface ProviderStatus {
  id: "codex" | "claude";
  status: "ready" | "not_installed" | "unsupported" | "authentication_required" | "unavailable";
  version: string | null;
  message: string;
}

export interface IntelligenceSettings {
  provider: "codex" | "claude" | null;
  autoSummarize: boolean;
  maxInputBytes: number;
}

export interface SearchResult {
  id: string;
  type: "event" | "summary";
  sessionId: string;
  workstreamId: string;
  agent: string;
  title: string;
  snippet: string;
  occurredAt: string;
  score: number;
}

export interface Checkpoint {
  oid: string;
  parents: string[];
  createdAt: string;
  author: string;
  message: string;
}
export interface ConversationBranch {
  name: string;
  oid: string;
}
export interface PublishStatus {
  enabled: boolean;
  lastSuccess: string | null;
  error: string | null;
}
export interface RepositoryStatus {
  head: string | null;
  branch: string | null;
  branches: ConversationBranch[];
  uncheckpointed: number;
  unpushed: number;
  publishing: PublishStatus;
  mode: "local" | "hosted";
  indexedRevision: string | null;
}
