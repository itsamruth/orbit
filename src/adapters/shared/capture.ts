import type { Session, UniversalEvent } from "../../domain/index.js";
import { PolicyFilter, type CapturePolicy } from "../../security/index.js";
import type { Repository } from "../../storage/journal/repository.js";
import { normalizeBatch, type AgentAdapter, type NativeSession, type readRecords } from "./index.js";
import { NORMALIZER_VERSION, type NativeState } from "./normalize.js";

// Privacy filtering happens on complete content, before splitting; secrets cannot
// escape filtering by straddling a chunk boundary.
export function splitEvent(event: UniversalEvent): UniversalEvent[] {
  if (Buffer.byteLength(JSON.stringify(event)) <= 240000) return [event];
  const serialized = JSON.stringify(event.payload);
  const pieces: string[] = [];
  let text = "", bytes = 0;
  for (const character of serialized) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 24000) { pieces.push(text); text = ""; bytes = 0; }
    text += character; bytes += size;
  }
  if (text) pieces.push(text);
  return pieces.map((text, index) => ({ ...event, id: event.id + "_part_" + index, chunk: { groupId: event.id, index, total: pieces.length }, payload: { type: "content_chunk", text } }));
}

export async function captureNativeBatch(
  repo: Repository, agent: AgentAdapter, session: Session, native: NativeSession,
  batch: Awaited<ReturnType<typeof readRecords>>, sequence: number, policy: CapturePolicy,
): Promise<{ events: UniversalEvent[]; nextSequence: number }> {
  const key = "capture:" + session.id;
  const saved = JSON.parse((await repo.state(key)) ?? "null") as (NativeState & { filter: string[] }) | null;
  if (saved && saved.version !== NORMALIZER_VERSION) throw new Error("Unsupported saved normalizer version; refusing to reinterpret a partial capture.");
  const state: NativeState = saved ?? { version: NORMALIZER_VERSION, nativeVersion: "unknown", turnId: null, seen: [] };
  const filter = new PolicyFilter();
  filter.restore(saved?.filter ?? JSON.parse((await repo.state("filter:" + session.id)) ?? "[]"));
  const normalized = normalizeBatch(agent, { projectId: session.projectId, workstreamId: session.workstreamId, sessionId: session.id }, batch.records, sequence, session.startedAt, state, session.bootstrapHash);
  const events: UniversalEvent[] = [];
  for (const event of normalized) {
    const result = filter.apply(event, policy);
    const kept: UniversalEvent = result.action === "keep" ? result.event : { ...event, payload: { type: "coverage", reason: result.reason }, coverage: ["Content excluded by capture policy."] };
    for (const part of splitEvent(kept)) events.push({ ...part, sequence: sequence++ });
  }
  await repo.capture(session.projectId, native.path, batch.position, events, { key, value: JSON.stringify({ ...state, filter: filter.snapshot() }) });
  return { events, nextSequence: sequence };
}
