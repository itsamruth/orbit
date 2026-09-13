const object = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const allowed = (v: Record<string, any>, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));
const identifier = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
const string = (v: unknown) => typeof v === "string";
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const statuses = ["completed", "failed", "interrupted", "unknown"];
export function validateEventRecord(o: Record<string, any>): void {
  const fail = (): never => { throw new Error("Invalid event payload, provenance, or schema"); };
  if (![1, 2].includes(o.schemaVersion) || !integer(o.sequence) || !identifier(o.sessionId) || !identifier(o.workstreamId) || typeof o.occurredAt !== "string" || !Number.isFinite(Date.parse(o.occurredAt))) fail();
  const v2 = o.schemaVersion === 2, p = o.payload;
  if (!object(p)) fail();
  const fields: Record<string, string[]> = {
    user_message: ["type", "text", ...(v2 ? ["content"] : [])], assistant_message: ["type", "text", ...(v2 ? ["content"] : [])],
    tool_call: ["type", "callId", "name", "input"], tool_result: ["type", "callId", "output", "failed", ...(v2 ? ["status", "exitCode"] : [])],
    command: ["type", "command", "exitCode"], file_modified: ["type", "path"], git_state: ["type", "workspace"], session_ended: ["type", "reason"],
    ...(v2 ? { turn_state: ["type", "status"], context_summary: ["type", "text", "coverage"], runtime_context: ["type", "reason"], coverage: ["type", "reason"], content_chunk: ["type", "text"] } : {}),
  };
  if (!fields[p.type] || !allowed(p, fields[p.type]!)) fail();
  if (["user_message", "assistant_message", "context_summary", "content_chunk"].includes(p.type) && !string(p.text)) fail();
  if (p.content !== undefined && (!Array.isArray(p.content) || !p.content.every((c: unknown) => object(c) && allowed(c, ["type", "reference", "mediaType", "availability"]) && c.type === "attachment" && string(c.reference) && string(c.mediaType) && ["referenced", "unavailable"].includes(c.availability)))) fail();
  if (["tool_call", "tool_result"].includes(p.type) && (!string(p.callId) || !p.callId || p.callId.length > 200)) fail();
  if (p.type === "tool_call" && (!string(p.name) || !p.name || p.name.length > 200 || !("input" in p))) fail();
  if (p.type === "tool_result" && (!string(p.output) || typeof p.failed !== "boolean" || (v2 && !statuses.includes(p.status)))) fail();
  if (p.exitCode !== undefined && p.exitCode !== null && !Number.isInteger(p.exitCode)) fail();
  if (p.type === "command" && (!string(p.command) || !(p.exitCode === null || Number.isInteger(p.exitCode)))) fail();
  if (p.type === "file_modified" && !string(p.path)) fail();
  if (["session_ended", "coverage", "runtime_context"].includes(p.type) && !string(p.reason)) fail();
  if (p.type === "turn_state" && !["active", ...statuses].includes(p.status)) fail();
  if (p.type === "context_summary" && !["unknown", "complete", "truncated"].includes(p.coverage)) fail();
  if (p.type === "git_state") {
    const w = p.workspace;
    if (!object(w) || !string(w.root) || !string(w.porcelain) || typeof w.dirty !== "boolean" || !(w.branch === null || string(w.branch)) || !(w.head === null || string(w.head))) fail();
  }
  if (!v2 && ["source", "messageId", "turnId", "phase", "coverage", "chunk"].some((k) => k in o)) fail();
  if (v2) {
    const s = o.source;
    if (!object(s) || !allowed(s, ["adapter", "normalizerVersion", "nativeVersion", "recordId", "offset", "blockIndex"]) || !string(s.adapter) || s.normalizerVersion !== 2 || !string(s.nativeVersion) || !string(s.recordId) || !integer(s.offset) || !integer(s.blockIndex)) fail();
    if (o.messageId !== undefined && !string(o.messageId)) fail();
    if (o.turnId !== undefined && !string(o.turnId)) fail();
    if (o.phase !== undefined && !["commentary", "final", "unknown"].includes(o.phase)) fail();
    if (o.coverage !== undefined && (!Array.isArray(o.coverage) || !o.coverage.every(string))) fail();
    if (o.chunk !== undefined) {
      const c = o.chunk;
      if (!object(c) || !allowed(c, ["groupId", "index", "total"]) || !identifier(c.groupId) || !integer(c.index) || !integer(c.total) || c.total < 1 || c.index >= c.total || p.type !== "content_chunk") fail();
    } else if (p.type === "content_chunk") fail();
  }
}
