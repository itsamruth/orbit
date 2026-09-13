import { createHash } from "node:crypto";
import type { AttachmentReference, EventPayload, ToolStatus } from "../../domain/index.js";

export const NORMALIZER_VERSION = 2;
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const bootstrapText = (marker: string, context?: string) =>
  "[Orbit capture " + marker + "]\n" + (context ?? "Orbit is recording this project session. Wait for the developer to describe the task.");

export interface NativeState {
  version: number;
  nativeVersion: string;
  turnId: string | null;
  seen: string[];
}
export interface NormalizedPart {
  payload: EventPayload;
  blockIndex: number;
  messageId?: string;
  phase?: "commentary" | "final" | "unknown";
}

// Match generated wrappers, not arbitrary XML or prose mentioning an environment.
export function cleanUserText(text: string): { text: string; stripped: boolean } {
  let stripped = false;
  const cleaned = text.replace(/(?:^|\n)<environment_context>\s*\n[\s\S]*?<\/environment_context>(?=\s*(?:\n|$))/g, (block) => {
    if (!/<cwd>[^<]+<\/cwd>/.test(block) || !/<shell>[^<]+<\/shell>/.test(block)) return block;
    stripped = true;
    return "";
  }).trim();
  return { text: cleaned, stripped };
}

function bootstrap(text: string, expectedHash?: string): boolean {
  if (expectedHash) return digest(text) === expectedHash;
  // Compatibility for previously recorded Orbit launches. A bare marker is not enough.
  return /^\[Orbit capture [a-zA-Z0-9_-]+\]\n(?:Orbit is recording this project session\. Wait for the developer to describe the task\.$|Continue the coding task described in this Orbit handoff\.|Orbit conversation continuation\.)/.test(text);
}

function attachment(block: any): AttachmentReference {
  const reference = block.path ?? block.url ?? block.image_url?.url ?? block.image_url ?? block.source?.url ?? block.source?.path;
  const safe = typeof reference === "string" && !reference.startsWith("data:");
  return {
    type: "attachment",
    reference: safe ? reference : "embedded attachment not retained",
    mediaType: typeof block.source?.media_type === "string" ? block.source.media_type : /image/.test(block.type) ? "image/*" : "application/octet-stream",
    availability: safe ? "referenced" : "unavailable",
  };
}

function outcome(value: any, output: unknown): { status: ToolStatus; exitCode?: number | null } {
  let parsed = output;
  if (typeof output === "string") {
    try { parsed = JSON.parse(output); } catch { /* Native output may be plain text. */ }
  }
  const p = parsed as any;
  const exit = value.exit_code ?? value.exitCode ?? p?.exit_code ?? p?.exitCode;
  if (value.is_interrupt === true || value.interrupted === true || p?.interrupted === true)
    return { status: "interrupted" };
  if (Number.isInteger(exit)) return { status: exit === 0 ? "completed" : "failed", exitCode: exit };
  if (value.is_error === true || value.failed === true || p?.is_error === true)
    return { status: "failed" };
  if (value.is_error === false || value.success === true || p?.success === true)
    return { status: "completed" };
  return { status: "unknown" };
}

export function normalizeNative(agent: string, record: unknown, expectedHash?: string): NormalizedPart[] {
  const r = record as any;
  if (!r || typeof r !== "object") return [];
  if (r.type === "orbit_parse_error") return [{ blockIndex: 0, payload: { type: "coverage", reason: "Malformed native JSONL record was not captured." } }];
  const out: NormalizedPart[] = [];
  const add = (payload: EventPayload, blockIndex = 0, extra: Partial<NormalizedPart> = {}) => out.push({ payload, blockIndex, ...extra });
  if (agent === "codex" && r.type === "event_msg") {
    const p = r.payload ?? {};
    const statuses: Record<string, "active" | "completed" | "interrupted" | "failed"> = {
      task_started: "active", task_complete: "completed", turn_aborted: "interrupted", task_failed: "failed",
    };
    if (statuses[p.type]) add({ type: "turn_state", status: statuses[p.type]! });
    return out;
  }
  if ((agent === "codex" && r.type === "compacted") || (agent === "claude" && r.type === "system" && r.subtype === "compact_boundary")) {
    const text = r.payload?.message ?? r.message?.content ?? r.summary;
    add(typeof text === "string" ? { type: "context_summary", text, coverage: "unknown" } : { type: "coverage", reason: "Native context was compacted; no portable summary was supplied." });
    return out;
  }
  const codex = agent === "codex";
  if (codex ? r.type !== "response_item" : !["user", "assistant"].includes(r.type)) return [];
  const p = codex ? r.payload : r.message;
  if (!p) return [];
  if (codex && ["function_call", "custom_tool_call"].includes(p.type)) {
    let input = p.arguments ?? p.input ?? "";
    if (typeof input === "string") { try { input = JSON.parse(input); } catch { /* Preserve non-JSON tool inputs. */ } }
    if (typeof p.call_id !== "string" || typeof p.name !== "string") add({ type: "coverage", reason: "Tool call lacked a native identifier or name." });
    else add({ type: "tool_call", callId: p.call_id, name: p.name, input });
    return out;
  }
  if (codex && ["function_call_output", "custom_tool_call_output"].includes(p.type)) {
    const result = outcome(p, p.output);
    if (typeof p.call_id !== "string") add({ type: "coverage", reason: "Tool result lacked a native call identifier." });
    else add({ type: "tool_result", callId: p.call_id, output: typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? null), failed: result.status === "failed", ...result });
    return out;
  }
  const role = codex ? p.role : r.type;
  if ((codex && p.type !== "message") || !["user", "assistant"].includes(role)) return [];
  const content = typeof p.content === "string" ? [{ type: "text", text: p.content }] : p.content;
  if (!Array.isArray(content)) return [];
  const joined = content.filter((b: any) => ["text", "input_text", "output_text"].includes(b.type)).map((b: any) => b.text ?? "").join("\n");
  if (role === "user" && bootstrap(joined, expectedHash)) return [];
  const messageId = String(p.id ?? r.uuid ?? "");
  const phase = role === "assistant" ? (p.phase === "commentary" ? "commentary" : p.phase === "final_answer" || p.phase === "final" || p.stop_reason === "end_turn" ? "final" : "unknown") : undefined;
  for (const [index, block] of content.entries()) {
    if (block.type === "tool_use") {
      if (typeof block.id === "string" && typeof block.name === "string") add({ type: "tool_call", callId: block.id, name: block.name, input: block.input ?? {} }, index);
      else add({ type: "coverage", reason: "Tool call lacked a native identifier or name." }, index);
    } else if (block.type === "tool_result") {
      const result = outcome(block, block.content);
      if (typeof block.tool_use_id === "string") add({ type: "tool_result", callId: block.tool_use_id, output: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? null), failed: result.status === "failed", ...result }, index);
      else add({ type: "coverage", reason: "Tool result lacked a native call identifier." }, index);
    } else if (["text", "input_text", "output_text"].includes(block.type) && typeof block.text === "string") {
      if (r.isMeta === true || r.userType === "system") {
        add({ type: "runtime_context", reason: "Native generated message separated from human conversation." }, index);
        continue;
      }
      const cleaned = role === "user" ? cleanUserText(block.text) : { text: block.text, stripped: false };
      if (cleaned.text) add({ type: role === "user" ? "user_message" : "assistant_message", text: cleaned.text }, index, { ...(messageId ? { messageId } : {}), ...(phase ? { phase } : {}) });
      if (cleaned.stripped && !cleaned.text) add({ type: "runtime_context", reason: "Generated environment context omitted from conversation." }, index);
    } else if (["image", "input_image", "image_url", "document", "resource", "resource_link"].includes(block.type)) {
      const ref = attachment(block);
      add({ type: role === "user" ? "user_message" : "assistant_message", text: "[Attachment: " + ref.reference + "]", content: [ref] }, index, messageId ? { messageId } : {});
    } else if (!["thinking", "redacted_thinking", "reasoning"].includes(block.type)) {
      add({ type: "coverage", reason: "Unsupported native content block was not transferred." }, index);
    }
  }
  if (!codex && role === "assistant" && p.stop_reason === "end_turn") add({ type: "turn_state", status: "completed" }, content.length);
  return out;
}
