import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { EventPayload } from "../../domain/index.js";
import { jsonlFiles, prefix, type AgentAdapter } from "../shared/index.js";
const exec = promisify(execFile);
export function normalizeCodex(record: unknown): EventPayload[] {
  const r = record as any;
  if (!r || r.type !== "response_item") return [];
  const p = r.payload;
  if (!p) return [];
  if (p.type === "message" && ["user", "assistant"].includes(p.role)) {
    const text = (p.content ?? [])
      .filter((c: any) =>
        ["input_text", "output_text", "text"].includes(c.type),
      )
      .map((c: any) => c.text ?? "")
      .join("\n");
    if (!text || text.startsWith("[Orbit capture")) return [];
    return [
      { type: p.role === "user" ? "user_message" : "assistant_message", text },
    ];
  }
  if (p.type === "function_call" || p.type === "custom_tool_call") {
    let input = p.arguments ?? p.input ?? "";
    try {
      input = JSON.parse(input);
    } catch {}
    return [{ type: "tool_call", callId: p.call_id, name: p.name, input }];
  }
  if (p.type === "function_call_output" || p.type === "custom_tool_call_output")
    return [
      {
        type: "tool_result",
        callId: p.call_id,
        output:
          typeof p.output === "string" ? p.output : JSON.stringify(p.output),
        failed: false,
      },
    ];
  return [];
}
export const codexAdapter: AgentAdapter = {
  id: "codex",
  isTurnComplete(record) {
    const r = record as any;
    return r?.type === "event_msg" && r.payload?.type === "task_complete";
  },
  async probe() {
    const [{ stdout: version }, { stdout: help }] = await Promise.all([
      exec("codex", ["--version"]),
      exec("codex", ["--help"]),
    ]);
    if (!help.includes("[PROMPT]"))
      throw new Error("This Codex CLI does not support initial user prompts");
    return {
      version: version.trim(),
      capture: "jsonl",
      continuation: "user-prompt",
      maxContextBytes: 48000,
    };
  },
  async discover(projectRoot, identity) {
    const root = join(
      process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      "sessions",
    );
    const matches = [];
    for (const path of await jsonlFiles(root)) {
      if (identity?.since && (await stat(path)).mtimeMs < identity.since)
        continue;
      const head = await prefix(path);
      let meta;
      try {
        meta = JSON.parse(head.split("\n")[0] ?? "");
      } catch {
        continue;
      }
      if (meta.type !== "session_meta" || meta.payload?.cwd !== projectRoot)
        continue;
      if (identity?.nativeId && meta.payload.id !== identity.nativeId) continue;
      if (identity?.marker && !head.includes(identity.marker)) continue;
      matches.push({ id: String(meta.payload.id), projectRoot, path });
    }
    return matches;
  },
  normalize: normalizeCodex,
  launchArgs({ marker, context, args }) {
    return [
      ...args,
      "[Orbit capture " +
        marker +
        "]\n" +
        (context ??
          "Orbit is recording this project session. Wait for the developer to describe the task."),
    ];
  },
};
