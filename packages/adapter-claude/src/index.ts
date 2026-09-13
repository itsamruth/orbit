import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { jsonlFiles, prefix, type AgentAdapter } from "@orbit/adapter-kit";
import type { EventPayload } from "@orbit/core";
const exec = promisify(execFile);
export function normalizeClaude(record: unknown): EventPayload[] {
  const r = record as any;
  if (!r || !["user", "assistant"].includes(r.type) || !r.message) return [];
  const content = r.message.content;
  if (typeof content === "string")
    return content.startsWith("[Orbit capture")
      ? []
      : [
          {
            type: r.type === "user" ? "user_message" : "assistant_message",
            text: content,
          },
        ];
  if (!Array.isArray(content)) return [];
  const out: EventPayload[] = [];
  for (const c of content) {
    if (c.type === "text" && !c.text.startsWith("[Orbit capture"))
      out.push({
        type: r.type === "user" ? "user_message" : "assistant_message",
        text: c.text,
      });
    if (c.type === "tool_use")
      out.push({
        type: "tool_call",
        callId: c.id,
        name: c.name,
        input: c.input,
      });
    if (c.type === "tool_result")
      out.push({
        type: "tool_result",
        callId: c.tool_use_id,
        output:
          typeof c.content === "string" ? c.content : JSON.stringify(c.content),
        failed: c.is_error === true,
      });
  }
  return out;
}
export const claudeAdapter: AgentAdapter = {
  id: "claude",
  isTurnComplete(record) {
    const r = record as any;
    return r?.type === "assistant" && r.message?.stop_reason === "end_turn";
  },
  async probe() {
    const [{ stdout: version }, { stdout: help }] = await Promise.all([
      exec("claude", ["--version"]),
      exec("claude", ["--help"]),
    ]);
    if (!help.includes("--session-id"))
      throw new Error("This Claude CLI does not support explicit session IDs");
    return {
      version: version.trim(),
      capture: "jsonl",
      continuation: "user-prompt",
      maxContextBytes: 48000,
    };
  },
  async discover(projectRoot, identity) {
    const root = join(
      process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
      "projects",
    );
    const matches = [];
    for (const path of await jsonlFiles(root, 1)) {
      if (identity?.nativeId && basename(path) !== identity.nativeId + ".jsonl")
        continue;
      if (identity?.nativeId) {
        matches.push({ id: identity.nativeId, projectRoot, path });
        continue;
      }
      const first = (await prefix(path)).split("\n").filter(Boolean);
      let metadata;
      for (const line of first) {
        try {
          const r = JSON.parse(line);
          if (r.cwd === projectRoot && r.sessionId) {
            metadata = r;
            break;
          }
        } catch {}
      }
      if (metadata) matches.push({ id: metadata.sessionId, projectRoot, path });
    }
    return matches;
  },
  normalize: normalizeClaude,
  launchArgs({ nativeId, marker, context, args }) {
    return [
      "--session-id",
      nativeId,
      ...args,
      "[Orbit capture " +
        marker +
        "]\n" +
        (context ??
          "Orbit is recording this project session. Wait for the developer to describe the task."),
    ];
  },
};
