import { normalizeNative, bootstrapText } from "../shared/normalize.js";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { EventPayload } from "../../domain/index.js";
import { jsonlFiles, prefix, type AgentAdapter } from "../shared/index.js";
const exec = promisify(execFile);
export function normalizeClaude(record: unknown): EventPayload[] {
  return normalizeNative("claude", record).map((part) => part.payload);
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
      bootstrapText(marker, context),
    ];
  },
};
