import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  chmod,
  readFile,
  rm,
} from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  Repository,
  SqliteDatabase,
} from "../packages/local-store/dist/index.js";
const exec = promisify(execFile);
test("CLI captures exact native session and switches with preserved context", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "project"),
    bin = join(dir, "bin");
  await mkdir(root);
  await mkdir(bin);
  for (const agent of ["codex", "claude"]) {
    await copyFile(resolve("tests/fixtures/fake-agent.mjs"), join(bin, agent));
    await chmod(join(bin, agent), 0o755);
  }
  const env = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    CODEX_HOME: join(dir, "codex"),
    CLAUDE_CONFIG_DIR: join(dir, "claude"),
    ORBIT_CONFIG_DIR: join(dir, "orbit-config"),
  };
  const cli = resolve("apps/cli/dist/index.js");
  const run = (args) =>
    exec(process.execPath, [cli, ...args], { cwd: root, env });
  await run(["init"]);
  await run(["new", "Refresh token flow"]);
  let stderr = "";
  const child = spawn(process.execPath, [cli, "codex"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => (stderr += d));
  let childExit = new Promise((resolve) => child.once("exit", resolve));
  t.after(() => {
    child.kill("SIGTERM");
  });
  const config = JSON.parse(
    await readFile(join(root, ".orbit/project.json"), "utf8"),
  );
  let captured = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const db = new SqliteDatabase(join(root, ".orbit/state/journal.sqlite"));
    const repo = new Repository(db);
    const events = await repo.list(config.projectId, "event");
    await db.close();
    if (events.some((e) => e.payload.type === "user_message")) {
      captured = true;
      break;
    }
  }
  assert.ok(captured, stderr);
  await assert.rejects(
    exec(process.execPath, [cli, "switch", "claude"], {
      cwd: root,
      env: { ...env, ORBIT_FIXTURE_BAD_HELP: "claude" },
    }),
    /explicit session IDs/,
  );
  assert.equal(child.exitCode, null);
  const switched = await exec(process.execPath, [cli, "switch", "claude"], {
    cwd: root,
    env: { ...env, ORBIT_FIXTURE_EXIT: "1" },
    timeout: 25000,
  });
  await childExit;
  const db = new SqliteDatabase(join(root, ".orbit/state/journal.sqlite"));
  t.after(() => db.close());
  const repo = new Repository(db);
  const sessions = await repo.list(config.projectId, "session");
  assert.equal(sessions.length, 2, switched.stderr);
  assert.deepEqual(
    sessions.map((s) => s.agent),
    ["codex", "claude"],
  );
  assert.ok(sessions.every((s) => s.status === "ended"));
  assert.equal(new Set(sessions.map((s) => s.workstreamId)).size, 1);
  const claudeSession = sessions[1];
  const transcript = await readFile(
    join(
      dir,
      "claude",
      "projects",
      "fixture",
      claudeSession.nativeSessionId + ".jsonl",
    ),
    "utf8",
  );
  assert.match(transcript, /Implement token refresh and test expiry/);
  await exec(
    process.execPath,
    [cli, "continue", sessions[0].workstreamId, "--agent", "codex"],
    { cwd: root, env: { ...env, ORBIT_FIXTURE_EXIT: "1" }, timeout: 10000 },
  );
  const final = await repo.list(config.projectId, "session");
  assert.deepEqual(
    final.map((s) => s.agent),
    ["codex", "claude", "codex"],
  );
  assert.ok(final.every((s) => s.status === "ended"));
  await assert.rejects(
    readFile(join(root, ".orbit/process.json")),
    (e) => e.code === "ENOENT",
  );
});
