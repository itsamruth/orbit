#!/usr/bin/env node
// Protocol fixture: no model, credentials, network, or source edits.
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
const args = process.argv.slice(2);
const agent = basename(process.argv[1]);
if (args.includes("--version")) {
  console.log(agent === "codex" ? "codex-cli fixture" : "Claude Code fixture");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(
    process.env.ORBIT_FIXTURE_BAD_HELP === agent
      ? "unsupported"
      : "[PROMPT] --session-id",
  );
  process.exit(0);
}
const prompt = args.at(-1);
const cwd = process.cwd();
const now = () => new Date().toISOString();
let path;
if (agent === "codex") {
  const marker = /\[Orbit capture ([^\]]+)/.exec(prompt)?.[1] ?? "fixture";
  path = join(
    process.env.CODEX_HOME,
    "sessions",
    "2026",
    "09",
    "10",
    "rollout-" + marker + ".jsonl",
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      type: "session_meta",
      payload: { id: "native-codex-" + marker, cwd },
    }) + "\n",
  );
  for (const text of [prompt, "Implement token refresh and test expiry"])
    await appendFile(
      path,
      JSON.stringify({
        timestamp: now(),
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }) + "\n",
    );
} else {
  const nativeId = args[args.indexOf("--session-id") + 1];
  path = join(
    process.env.CLAUDE_CONFIG_DIR,
    "projects",
    "fixture",
    nativeId + ".jsonl",
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      sessionId: nativeId,
      cwd,
      type: "user",
      timestamp: now(),
      message: { content: prompt },
    }) + "\n",
  );
  await appendFile(
    path,
    JSON.stringify({
      sessionId: nativeId,
      cwd,
      type: "assistant",
      timestamp: now(),
      message: {
        content: [
          {
            type: "text",
            text: "I have the previous objective and will continue testing expiry.",
          },
        ],
      },
    }) + "\n",
  );
}
const timer = setInterval(() => {}, 1000);
process.on("SIGTERM", () => {
  clearInterval(timer);
  process.exit(0);
});
if (process.env.ORBIT_FIXTURE_EXIT === "1")
  setTimeout(() => process.exit(0), 1200);
