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
import { GitRepository } from "../dist/storage/git/index.js";
const exec = promisify(execFile);

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "orbit-switch-"));
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
    ORBIT_CONFIG_DIR: join(dir, "config"),
    ORBIT_FIXTURE_EXIT: "1",
  };
  const cli = resolve("bin/orbit.js");
  const run = (args) =>
    exec(process.execPath, [cli, ...args], { cwd: root, env, timeout: 25000 });
  await run(["init"]);
  const { projectId } = JSON.parse(
    await readFile(join(root, ".orbit/project.json"), "utf8"),
  );
  return { dir, root, bin, env, cli, run, projectId };
}

test("switch after Ctrl+C selects the latest conversation despite an empty active workstream", async (t) => {
  const f = await setup(t);
  await f.run(["new", "Continue my Claude task"]);
  const child = spawn(process.execPath, [f.cli, "claude"], {
    cwd: f.root,
    env: { ...f.env, ORBIT_FIXTURE_EXIT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  t.after(() => child.kill("SIGTERM"));
  const repo = await GitRepository.open(f.root);
  t.after(() => repo.db.close());
  let captured = false;
  for (let i = 0; i < 80; i++) {
    const events = await repo.list(f.projectId, "event");
    if (events.some((event) => event.payload.type === "assistant_message")) {
      captured = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(captured, stderr);
  child.kill("SIGINT");
  await exited;
  await f.run(["new", "Empty workstream must not steal the switch"]);
  const switched = await f.run(["switch", "codex"]);
  assert.match(switched.stderr, /Latest conversation: Continue my Claude task/);
  assert.match(switched.stderr, /From: claude  ->  codex/);
  await repo.exclusive(() => repo.refresh());
  const sessions = await repo.list(f.projectId, "session");
  assert.equal(sessions.length, 2);
  assert.equal(
    new Set(sessions.map((session) => session.workstreamId)).size,
    1,
  );
  const codex = sessions.find((session) => session.agent === "codex");
  const native = JSON.parse(await repo.state("native:" + codex.id));
  assert.match(await readFile(native.path, "utf8"), /previous objective/);
});

test("switch imports a plain Claude transcript and preserves it when switching back", async (t) => {
  const f = await setup(t);
  await exec(
    join(f.bin, "claude"),
    ["--session-id", "native-direct", "Fix the login redirect"],
    { cwd: f.root, env: f.env, timeout: 10000 },
  );
  const switched = await f.run(["switch", "codex"]);
  assert.match(switched.stderr, /importing the latest claude conversation/);
  assert.match(switched.stderr, /Latest conversation: Fix the login redirect/);
  const returned = await f.run(["switch", "claude"]);
  assert.match(returned.stderr, /From: codex  ->  claude/);
  const repo = await GitRepository.open(f.root);
  t.after(() => repo.db.close());
  const sessions = await repo.list(f.projectId, "session");
  assert.equal(sessions.length, 3);
  assert.equal(
    new Set(sessions.map((session) => session.workstreamId)).size,
    1,
  );
  const final = sessions.find(
    (session) => session.agent === "claude" && session.captureMode === "live",
  );
  const native = JSON.parse(await repo.state("native:" + final.id));
  assert.match(await readFile(native.path, "utf8"), /Fix the login redirect/);
});

test("switch with no conversation gives a useful error without launching an agent", async (t) => {
  const f = await setup(t);
  await assert.rejects(
    f.run(["switch", "codex"]),
    /No saved conversation found in this project/,
  );
  const repo = await GitRepository.open(f.root);
  t.after(() => repo.db.close());
  assert.equal((await repo.list(f.projectId, "session")).length, 0);
});
