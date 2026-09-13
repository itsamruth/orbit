export type AgentId = string;
export type SessionStatus = "active" | "paused" | "ended" | "interrupted";

export interface ProjectConfig {
  version: 1;
  projectId: string;
}

export interface WorkspaceState {
  root: string;
  branch: string | null;
  head: string | null;
  /** Git porcelain v1, NUL-separated; preserves unusual filenames. */
  porcelain: string;
  dirty: boolean;
}

export interface Workstream {
  id: string;
  projectId: string;
  title: string;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
  titleSource?: "automatic" | "manual";
}

export interface Session {
  id: string;
  projectId: string;
  workstreamId: string;
  agent: AgentId;
  nativeSessionId: string;
  origin?: { checkpoint: string; workstreamId: string };
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  captureMode?: "live" | "imported";
  importedAt?: string;
  sourceFingerprint?: string;
  normalizerVersion?: number;
  bootstrapHash?: string;
  continuation?: {
    sessionId: string;
    throughEventId: string | null;
    handoffId: string;
  };
}

export interface EvidenceItem {
  text: string;
  evidenceEventIds: string[];
}

export interface SummaryTask extends EvidenceItem {
  status: "open" | "done";
}

export interface SessionSummary {
  schemaVersion: 1;
  id: string;
  projectId: string;
  workstreamId: string;
  sessionId: string;
  provider: "codex" | "claude";
  providerVersion: string;
  model: string | null;
  promptVersion: number;
  sourceHash: string;
  generatedAt: string;
  coverage: "complete" | "truncated";
  title: string;
  overview: string;
  objectives: string[];
  decisions: EvidenceItem[];
  rejectedApproaches: EvidenceItem[];
  openQuestions: EvidenceItem[];
  tasks: SummaryTask[];
  files: string[];
}

export type ToolStatus = "completed" | "failed" | "interrupted" | "unknown";
export type TurnStatus = "active" | ToolStatus;
export interface AttachmentReference {
  type: "attachment";
  reference: string;
  mediaType: string;
  availability: "referenced" | "unavailable";
}
export type EventPayload =
  | { type: "user_message" | "assistant_message"; text: string; content?: AttachmentReference[] }
  | { type: "tool_call"; callId: string; name: string; input: unknown }
  | { type: "tool_result"; callId: string; output: string; failed: boolean; status?: ToolStatus; exitCode?: number | null }
  | { type: "command"; command: string; exitCode: number | null }
  | { type: "file_modified"; path: string }
  | { type: "git_state"; workspace: WorkspaceState }
  | { type: "session_ended"; reason: string }
  | { type: "turn_state"; status: TurnStatus }
  | { type: "context_summary"; text: string; coverage: "unknown" | "complete" | "truncated" }
  | { type: "runtime_context"; reason: string }
  | { type: "coverage"; reason: string }
  | { type: "content_chunk"; text: string };

export interface UniversalEvent {
  schemaVersion: 1 | 2;
  id: string;
  projectId: string;
  workstreamId: string;
  sessionId: string;
  /** Monotonic within a session, never a project-global counter. */
  sequence: number;
  occurredAt: string;
  payload: EventPayload;
  source?: {
    adapter: string;
    normalizerVersion: number;
    nativeVersion: string;
    recordId: string;
    offset: number;
    blockIndex: number;
  };
  messageId?: string;
  turnId?: string;
  phase?: "commentary" | "final" | "unknown";
  coverage?: string[];
  chunk?: { groupId: string; index: number; total: number };
}

export interface Handoff {
  schemaVersion: 1;
  projectId: string;
  workstreamId: string;
  previousSessionId: string;
  previousNativeSessionId: string;
  previousAgent: AgentId;
  workspace: WorkspaceState;
  latestUserObjective: string | null;
  recentEvents: UniversalEvent[];
  truncated: boolean;
}
