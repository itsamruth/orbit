import type { Session, UniversalEvent, Workstream } from "../domain/index.js";
import { assembleEvents } from "../sessions/conversation.js";

const excerpt = (text: string) => text.length > 32000 ? text.slice(0, 32000) + "\n[Dashboard excerpt: full captured content is available through Orbit CLI.]" : text;
export function legacySession(session: Session): Session {
  const result = { ...session };
  delete result.normalizerVersion;
  delete result.bootstrapHash;
  delete result.continuation;
  return result;
}
export function legacyWorkstream(workstream: Workstream): Workstream {
  const result = { ...workstream };
  delete result.titleSource;
  return result;
}
export function legacyEvents(records: UniversalEvent[]): UniversalEvent[] {
  const original = new Map(records.map((event) => [event.id, event]));
  return assembleEvents(records).flatMap((event): UniversalEvent[] => {
    // Already-published v1 events are immutable. Compatibility interpretation
    // and v2 dashboard excerpts must never change their persisted payloads.
    if (event.schemaVersion === 1) return [original.get(event.id)!];
    const p = event.payload;
    if (p.type === "runtime_context") return [];
    let payload: UniversalEvent["payload"];
    switch (p.type) {
      case "user_message":
      case "assistant_message":
        payload = { type: p.type, text: excerpt(p.text) + (p.content?.length ? "\n[Attachment references only; binaries are not published.]" : "") + (event.coverage?.length && event.schemaVersion === 2 ? "\n[" + event.coverage.join(" ") + "]" : "") };
        break;
      case "tool_call": {
        const input = JSON.stringify(p.input);
        payload = { type: "tool_call", callId: p.callId, name: p.name, input: input.length > 32000 ? excerpt(input) : p.input };
        break;
      }
      case "tool_result":
        payload = { type: "tool_result", callId: p.callId, failed: p.failed, output: excerpt(p.output) + (event.schemaVersion === 2 ? "\n[Recorded outcome: " + (p.status ?? "unknown") + ".]" : "") };
        break;
      case "turn_state": payload = { type: "assistant_message", text: "[Orbit: recorded turn " + p.status + ".]" }; break;
      case "context_summary": payload = { type: "assistant_message", text: "[Native compaction summary; coverage " + p.coverage + "]\n" + excerpt(p.text) }; break;
      case "coverage": payload = { type: "assistant_message", text: "[Orbit coverage: " + p.reason + "]" }; break;
      case "content_chunk": payload = { type: "assistant_message", text: "[Orbit: content fragments could not be reconstructed.]" }; break;
      default: payload = p;
    }
    return [{ schemaVersion: 1, id: event.id, projectId: event.projectId, workstreamId: event.workstreamId, sessionId: event.sessionId, sequence: event.sequence, occurredAt: event.occurredAt, payload }];
  });
}
