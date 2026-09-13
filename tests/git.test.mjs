import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  GitRepository,
  git,
  gitText,
  readSnapshot,
  compare,
  cloneRepository,
  snapshotRepository,
} from "../dist/storage/git/index.js";
import {
  SqliteDatabase,
  Repository,
  fingerprint,
} from "../dist/storage/journal/index.js";
const exec = promisify(execFile);
const now = new Date().toISOString();
const project = {
  id: "prj_git",
  name: "Git conversations",
  owner: "local",
  description: "",
  repository: null,
  createdAt: now,
  updatedAt: now,
  cloudSyncEnabled: false,
  excludedPaths: [],
};
const work = {
  id: "work_git",
  projectId: project.id,
  title: "Build Git backend",
  branch: "main",
  createdAt: now,
  updatedAt: now,
};
const session = {
  id: "sess_git",
  projectId: project.id,
  workstreamId: work.id,
  agent: "codex",
  nativeSessionId: "native",
  status: "ended",
  startedAt: now,
  endedAt: now,
};
const event = (sequence, text = "message " + sequence) => ({
  schemaVersion: 1,
  id: "evt_" + sequence,
  projectId: project.id,
  workstreamId: work.id,
  sessionId: session.id,
  sequence,
  occurredAt: now,
  payload: { type: "user_message", text },
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "orbit-git-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = await GitRepository.open(root, true);
  t.after(() => repo.db.close());
  await repo.put(project.id, "project", project);
  await repo.put(project.id, "workstream", work);
  await repo.put(project.id, "session", session);
  return { root, repo };
}
test("real Git checkpoints, immutable chunks, branch isolation, clone and deletion history", async (t) => {
  const { root, repo } = await fixture(t);
  await repo.capture(project.id, "native", 10, [event(0)]);
  const first = await repo.checkpoint("First turn");
  assert.match(first, /^[a-f0-9]{40}$/);
  assert.equal((await repo.status()).uncheckpointed, 0);
  assert.equal((await readSnapshot(repo.history)).records.length, 4);
  await repo.capture(project.id, "native", 20, [event(1)]);
  const second = await repo.checkpoint("Second turn");
  assert.equal((await compare(repo.history, first, second)).changes.length, 1);
  await repo.createBranch("experiment", first);
  await repo.checkout("experiment");
  assert.equal((await repo.list(project.id, "event")).length, 1);
  await repo.remove(project.id, "session", session.id);
  await repo.checkpoint("Remove session");
  assert.equal(
    (await readSnapshot(repo.history, first)).records.filter(
      (r) => r.kind === "event",
    ).length,
    1,
  );
  await repo.checkout("main");
  assert.equal((await repo.list(project.id, "event")).length, 2);
  const remote = join(root, "remote.git");
  await mkdir(remote);
  await git(remote, ["init", "--bare", "--initial-branch=main"]);
  await repo.remote("origin", remote);
  await repo.push();
  const cloned = await cloneRepository(remote, join(root, "clone"));
  t.after(() => cloned.db.close());
  assert.deepEqual(
    (await cloned.branches()).map((b) => b.name),
    ["experiment", "main"],
  );
  assert.equal((await cloned.list(project.id, "event")).length, 2);
  await cloned.put(project.id, "event", event(2, "other device"));
  await cloned.checkpoint("Remote turn");
  await cloned.push();
  await repo.pull();
  assert.equal((await repo.list(project.id, "event")).length, 3);
  await repo.put(project.id, "event", event(3, "local divergence"));
  await repo.checkpoint("Local");
  await cloned.put(project.id, "event", event(4, "remote divergence"));
  await cloned.checkpoint("Remote");
  await cloned.push();
  await assert.rejects(repo.pull(), /fast-forward|diverg/i);
  assert.equal((await repo.list(project.id, "event")).length, 4);
});
test("journal survives restart and acknowledges a commit interrupted before finalization", async (t) => {
  const { repo } = await fixture(t);
  await repo.capture(project.id, "native", 123, [event(0)], {
    key: "filter:" + session.id,
    value: "[]",
  });
  const finish = repo.finish.bind(repo);
  repo.finish = async () => {
    throw new Error("crash after ref update");
  };
  await assert.rejects(repo.checkpoint("Durable checkpoint"), /crash/);
  assert.equal(await repo.offset("native"), 123);
  repo.finish = finish;
  await repo.exclusive(() => repo.refresh());
  assert.equal((await repo.status()).uncheckpointed, 0);
  assert.equal((await repo.log()).length, 1);
  await repo.checkpoint("No duplicate");
  assert.equal((await repo.log()).length, 1);
  await repo.capture(project.id, "native", 123, [event(0)]);
  await repo.checkpoint("Replay");
  assert.equal(
    (await readSnapshot(repo.history)).records.filter((r) => r.kind === "event")
      .length,
    1,
  );
});
test("10,000 events retain bounded pagination and continuation context", async (t) => {
  const { repo } = await fixture(t);
  for (let i = 0; i < 10000; i += 100)
    await repo.capture(
      project.id,
      "native",
      i + 100,
      Array.from({ length: 100 }, (_, j) => event(i + j)),
    );
  await repo.checkpoint("Large conversation");
  const reader = await snapshotRepository(repo.history);
  t.after(() => reader.db.close());
  const page = await reader.repo.page(
    project.id,
    "event",
    session.id,
    null,
    50,
  );
  assert.equal(page.items.length, 50);
  assert.equal(page.nextCursor, "50");
  const context = await reader.repo.handoffEvents(project.id, work.id);
  assert.ok(context.events.length <= 258);
  assert.equal(context.truncated, true);
});
test("repository rejects symlinks and foreign project data", async (t) => {
  const { repo } = await fixture(t);
  await repo.checkpoint("Init");
  await writeFile(join(repo.history, "untrusted.txt"), "not an Orbit record");
  await git(repo.history, ["add", "untrusted.txt"]);
  await git(repo.history, ["commit", "-m", "Invalid"]);
  await assert.rejects(
    readSnapshot(repo.history),
    /Unsupported repository entry/,
  );
});
test("CLI init and branches preserve the source repository", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orbit-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await writeFile(join(root, "code.txt"), "original");
  await git(root, ["add", "code.txt"]);
  await git(root, ["commit", "-m", "Source"]);
  const before = await gitText(root, ["rev-parse", "HEAD"]),
    index = await readFile(join(root, ".git", "index"));
  const cli = resolve("bin/orbit.js");
  await exec(process.execPath, [cli, "init"], { cwd: root });
  await exec(process.execPath, [cli, "branch", "experiment"], { cwd: root });
  await exec(process.execPath, [cli, "checkout", "experiment"], { cwd: root });
  assert.equal(await gitText(root, ["rev-parse", "HEAD"]), before);
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.equal(await gitText(root, ["status", "--porcelain"]), "");
  assert.equal(await readFile(join(root, "code.txt"), "utf8"), "original");
});

test("legacy migration preserves IDs, verifies Git content, and restarts without duplicate imports", async (t) => {
  const { migrate } = await import("../dist/storage/migrate.js");
  const root = await mkdtemp(join(tmpdir(), "orbit-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = new SqliteDatabase(join(root, ".orbit", "history.sqlite")),
    repo = new Repository(db);
  for (const [kind, data] of [
    ["project", project],
    ["workstream", work],
    ["session", session],
    ["event", event(0)],
  ])
    await repo.put(project.id, kind, data);
  await db.close();
  const dry = await migrate(root, project.id, true);
  assert.equal(dry.records, 4);
  await assert.rejects(access(join(root, ".orbit", "history", ".git")));
  const report = await migrate(root, project.id, false);
  assert.ok(report.checkpoint);
  await access(report.backup);
  assert.equal(
    (await readSnapshot(join(root, ".orbit", "history"))).records.length,
    4,
  );
  assert.equal((await migrate(root, project.id, false)).alreadyMigrated, true);
  const original = new SqliteDatabase(join(root, ".orbit", "history.sqlite"));
  assert.equal(
    (await new Repository(original).list(project.id, "event")).length,
    1,
  );
  await original.close();
});
test("automatic publishing is opt-in, preserves offline commits, and resumes", async (t) => {
  const { PublishWorker } = await import("../dist/publishing/worker.js");
  const { root, repo } = await fixture(t);
  await repo.put(project.id, "event", event(0));
  const oid = await repo.checkpoint("Local only");
  const remote = join(root, "remote.git");
  await mkdir(remote);
  await git(remote, ["init", "--bare", "--initial-branch=main"]);
  await repo.remote("origin", remote);
  const worker = new PublishWorker(repo);
  await worker.flush();
  assert.equal(await gitText(remote, ["rev-list", "--all", "--count"]), "0");
  await repo.setState("publish:enabled", "true");
  await worker.flush();
  assert.equal(await gitText(remote, ["rev-parse", "main"]), oid);
  await git(repo.history, [
    "remote",
    "set-url",
    "origin",
    join(root, "unavailable.git"),
  ]);
  await repo.put(project.id, "event", event(1));
  const next = await repo.checkpoint("Offline");
  await assert.rejects(worker.flush());
  assert.equal((await repo.status()).head, next);
  assert.ok((await repo.status()).publishing.error);
  await git(repo.history, ["remote", "set-url", "origin", remote]);
  await worker.flush();
  assert.equal(await gitText(remote, ["rev-parse", "main"]), next);
});

test("checkout validates untrusted branch entries before changing the working tree", async (t) => {
  const { repo, root } = await fixture(t);
  const first = await repo.checkpoint("Valid");
  const env = { GIT_INDEX_FILE: join(root, "malicious.index") };
  await git(repo.history, ["read-tree", first], { env });
  const blob = await gitText(repo.history, ["hash-object", "-w", "--stdin"], {
    input: "../../outside",
  });
  await git(repo.history, ["update-index", "--index-info"], {
    env,
    input: "120000 " + blob + "\tworkstreams/link.json\n",
  });
  const tree = await gitText(repo.history, ["write-tree"], { env });
  const malicious = await gitText(repo.history, [
    "commit-tree",
    tree,
    "-p",
    first,
    "-m",
    "Invalid symlink",
  ]);
  await git(repo.history, ["update-ref", "refs/heads/untrusted", malicious]);
  await assert.rejects(
    repo.checkout("untrusted"),
    /Unsupported repository entry/,
  );
  assert.equal(await gitText(repo.history, ["rev-parse", "HEAD"]), first);
  await assert.rejects(access(join(repo.history, "workstreams", "link.json")));
});

test("CLI continues a removed workstream from an earlier checkpoint on a new branch", async (t) => {
  const { copyFile, chmod } = await import("node:fs/promises");
  const { repo, root } = await fixture(t);
  await writeFile(
    join(root, ".orbit", "project.json"),
    JSON.stringify({ version: 1, projectId: project.id }),
  );
  await repo.put(project.id, "event", event(0, "Restore the earlier task"));
  const checkpoint = await repo.checkpoint("Original task");
  await repo.remove(project.id, "workstream", work.id);
  await repo.checkpoint("Remove current task");
  const bin = join(root, "bin");
  await mkdir(bin);
  await copyFile(resolve("tests/fixtures/fake-agent.mjs"), join(bin, "codex"));
  await chmod(join(bin, "codex"), 0o700);
  await exec(
    process.execPath,
    [
      resolve("bin/orbit.js"),
      "continue",
      work.id,
      "--agent",
      "codex",
      "--at",
      checkpoint,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: bin + ":" + process.env.PATH,
        CODEX_HOME: join(root, "native"),
        ORBIT_FIXTURE_EXIT: "1",
      },
      timeout: 15000,
    },
  );
  const snap = await readSnapshot(repo.history);
  assert.ok(
    snap.records.some(
      (r) => r.kind === "session" && r.data.origin?.checkpoint === checkpoint,
    ),
  );
  assert.match(
    await gitText(repo.history, ["symbolic-ref", "--short", "HEAD"]),
    /^continue\//,
  );
  assert.equal(
    (await readSnapshot(repo.history, "main")).records.some(
      (r) => r.kind === "workstream",
    ),
    false,
  );
});
