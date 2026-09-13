import { createHash } from "node:crypto";
import type { Session, SessionSummary, UniversalEvent, Workstream } from "../domain/index.js";
import type { Repository } from "../storage/journal/repository.js";
import { cleanUserText } from "../adapters/shared/normalize.js";

export interface Conversation {
  projectId: string;
  workstream: Workstream;
  sessions: Session[];
  records: UniversalEvent[];
  events: UniversalEvent[];
  summaries: SessionSummary[];
  coverage: string[];
}

export function legacyView(event: UniversalEvent): UniversalEvent {
  if (event.schemaVersion === 2) return event;
  let payload = event.payload;
  if (payload.type === "user_message") {
    const clean = cleanUserText(payload.text);
    if (clean.stripped) payload = clean.text ? { ...payload, text: clean.text } : { type: "runtime_context", reason: "Legacy generated environment context." };
    if (/^\[Orbit capture [a-zA-Z0-9_-]+\]\n(?:Orbit is recording this project session\.|Continue the coding task described in this Orbit handoff\.)/.test(event.payload.type === "user_message" ? event.payload.text : ""))
      payload = { type: "runtime_context", reason: "Legacy Orbit bootstrap." };
  }
  if (payload.type === "tool_result") payload = { ...payload, status: payload.failed ? "failed" : "unknown" };
  return { ...event, payload, coverage: ["Legacy record: native provenance and turn boundaries may be unavailable."] };
}

export function assembleEvents(records: UniversalEvent[]): UniversalEvent[] {
  const groups = new Map<string, UniversalEvent[]>();
  for (const record of records) if (record.chunk) {
    const key = record.sessionId + ":" + record.chunk.groupId;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const seen = new Set<string>();
  const result: UniversalEvent[] = [];
  for (const raw of records) {
    const event = legacyView(raw);
    if (!event.chunk) { result.push(event); continue; }
    const key = event.sessionId + ":" + event.chunk.groupId;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = groups.get(key)!.sort((a, b) => a.chunk!.index - b.chunk!.index);
    const complete = parts.length === event.chunk.total && parts.every((p, i) => p.chunk?.index === i && p.chunk.total === event.chunk!.total && p.payload.type === "content_chunk");
    const { chunk, ...base } = event;
    try {
      if (!complete) throw new Error("missing chunks");
      const payload = JSON.parse(parts.map((p) => p.payload.type === "content_chunk" ? p.payload.text : "").join(""));
      result.push({ ...base, id: chunk.groupId, payload });
    } catch {
      result.push({ ...base, id: chunk.groupId, payload: { type: "coverage", reason: "Incomplete or invalid captured content chunks." } });
    }
  }
  return result;
}

export function conversationTitle(workstream: Workstream, events: UniversalEvent[]): string {
  if (workstream.titleSource === "manual") return workstream.title;
  if (workstream.titleSource !== "automatic" && !/^(?:Untitled workstream|<environment_context>|\[Orbit capture)/.test(workstream.title)) return workstream.title;
  const first = events.find((event) => event.payload.type === "user_message");
  return first?.payload.type === "user_message" ? first.payload.text.replace(/\s+/g, " ").trim().slice(0, 120) || "Conversation" : "Conversation";
}

export async function readConversation(repo: Repository, projectId: string, workstreamId: string): Promise<Conversation> {
  const workstream = await repo.get<Workstream>(projectId, "workstream", workstreamId);
  if (!workstream) throw new Error("Workstream does not belong to this project");
  const unordered = (await repo.list<Session>(projectId, "session")).filter((s) => s.workstreamId === workstreamId).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const byId = new Map(unordered.map((s) => [s.id, s]));
  const sessions: Session[] = [], visited = new Set<string>(), visiting = new Set<string>();
  const coverage: string[] = [];
  const visit = (s: Session) => {
    if (visited.has(s.id)) return;
    if (visiting.has(s.id)) throw new Error("Conversation continuation lineage contains a cycle");
    visiting.add(s.id);
    if (s.continuation) {
      const parent = byId.get(s.continuation.sessionId);
      if (parent) visit(parent); else coverage.push("A continuation's source session is unavailable.");
    }
    visiting.delete(s.id); visited.add(s.id); sessions.push(s);
  };
  unordered.forEach(visit);
  const records: UniversalEvent[] = [], summaries: SessionSummary[] = [];
  for (const session of sessions) {
    const own = (await repo.list<UniversalEvent>(projectId, "event", session.id)).sort((a, b) => a.sequence - b.sequence);
    records.push(...own);
    const sourceHash = createHash("sha256").update(JSON.stringify(own)).digest("hex");
    for (const summary of await repo.list<SessionSummary>(projectId, "summary", session.id)) {
      if (summary.sourceHash === sourceHash) summaries.push(summary);
      else coverage.push("An outdated summary was excluded.");
    }
    if (await repo.state("import:warning:" + session.id)) coverage.push("Historical import reported incomplete capture.");
  }
  const events = assembleEvents(records);
  for (const event of events) {
    if (event.coverage) coverage.push(...event.coverage);
    if (event.payload.type === "coverage") coverage.push(event.payload.reason);
  }
  return { projectId, workstream: { ...workstream, title: conversationTitle(workstream, events) }, sessions, records, events, summaries, coverage: [...new Set(coverage)] };
}
