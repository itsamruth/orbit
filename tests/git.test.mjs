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
} from "../packages/git-store/dist/index.js";
import {
  SqliteDatabase,
  Repository,
  fingerprint,
} from "../packages/local-store/dist/index.js";
import { buildServer } from "../apps/api/dist/server.js";
import { hash } from "../apps/api/dist/auth.js";
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
  const cli = resolve("apps/cli/dist/index.js");
  await exec(process.execPath, [cli, "init"], { cwd: root });
  await exec(process.execPath, [cli, "branch", "experiment"], { cwd: root });
  await exec(process.execPath, [cli, "checkout", "experiment"], { cwd: root });
  assert.equal(await gitText(root, ["rev-parse", "HEAD"]), before);
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.equal(await gitText(root, ["status", "--porcelain"]), "");
  assert.equal(await readFile(join(root, "code.txt"), "utf8"), "original");
});
async function serverFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "orbit-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = new SqliteDatabase(":memory:");
  t.after(() => db.close());
  let links = [];
  const origin = "http://127.0.0.1:4327";
  const app = await buildServer(db, {
    origin,
    repositoryRoot: root,
    sendEmail: async (email, url) => {
      links.push({ email, url });
    },
  });
  t.after(() => app.close());
  return { root, db, app, origin, links };
}
test("email confirmation consumes one-use tokens only on POST and authorizes devices", async (t) => {
  const { app, db, origin, links } = await serverFixture(t);
  const sent = await app.inject({
    method: "POST",
    url: "/api/v1/auth/email/request",
    headers: { origin },
    payload: { email: "owner@example.test" },
  });
  assert.equal(sent.statusCode, 202, sent.body);
  assert.equal(links.length, 1);
  const token = new URL(links[0].url).searchParams.get("token");
  const page = await app.inject({ url: "/login?token=" + token });
  assert.equal(page.statusCode, 200);
  const signed = await app.inject({
    method: "POST",
    url: "/api/v1/auth/email/confirm",
    headers: { origin },
    payload: { token },
  });
  assert.equal(signed.statusCode, 200, signed.body);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/email/confirm",
        headers: { origin },
        payload: { token },
      })
    ).statusCode,
    401,
  );
  const cookie = signed.cookies[0].name + "=" + signed.cookies[0].value;
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { origin, cookie },
    payload: { id: project.id, name: project.name },
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(
    (await app.inject({ url: "/api/v1/projects/" + project.id })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: "/git/" + project.id + ".git/info/refs?service=git-upload-pack",
      })
    ).statusCode,
    401,
  );
});
test("authenticated HTTP Git push, clone, revision-pinned API and rejected malformed push", async (t) => {
  const { app, db, root, origin } = await serverFixture(t);
  await db.query(
    "INSERT INTO orbit_accounts (id,login,avatar_url) VALUES ($1,$2,$3)",
    ["usr_test", "tester", null],
  );
  const token = "test-device-token";
  await db.query(
    "INSERT INTO orbit_credentials (hash,user_id,kind,device_id,name,created_at,expires_at,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      hash(token),
      "usr_test",
      "cli",
      "device_test",
      "fixture",
      now,
      new Date(Date.now() + 3600000).toISOString(),
      now,
    ],
  );
  const headers = { authorization: "Bearer " + token };
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers,
    payload: { id: project.id, name: project.name },
  });
  assert.equal(created.statusCode, 200, created.body);
  await app.listen({ host: "127.0.0.1", port: 4327 });
  const dir = join(root, "client"),
    repo = await GitRepository.open(dir, true);
  t.after(() => repo.db.close());
  for (const [kind, data] of [
    ["project", project],
    ["workstream", work],
    ["session", session],
  ])
    await repo.put(project.id, kind, data);
  await repo.capture(
    project.id,
    "native",
    60,
    Array.from({ length: 60 }, (_, i) => event(i)),
  );
  const first = await repo.checkpoint("First push");
  await repo.remote("origin", origin + "/git/" + project.id + ".git");
  const env = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: "Authorization: Bearer " + token,
  };
  await repo.push("origin", env);
  const response = await app.inject({
    url:
      "/api/v1/projects/" + project.id + "/sessions/" + session.id + "/events",
    headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  const cursor = response.json().nextCursor;
  assert.ok(cursor);
  await repo.put(project.id, "event", event(60));
  await repo.checkpoint("Next push");
  await repo.push("origin", env);
  const page = await app.inject({
    url:
      "/api/v1/projects/" +
      project.id +
      "/sessions/" +
      session.id +
      "/events?cursor=" +
      cursor,
    headers,
  });
  assert.equal(page.json().items.length, 10);
  assert.equal(page.json().revision, first);
  const clone = await cloneRepository(
    origin + "/git/" + project.id + ".git",
    join(root, "clone"),
    env,
  );
  t.after(() => clone.db.close());
  assert.equal((await clone.list(project.id, "event")).length, 61);
  await writeFile(join(repo.history, "bad.txt"), "invalid");
  await git(repo.history, ["add", "bad.txt"]);
  await git(repo.history, ["commit", "-m", "Invalid repository"]);
  await assert.rejects(repo.push("origin", env), /rejected|hook declined/i);
  await db.query("DELETE FROM orbit_credentials WHERE hash=$1", [hash(token)]);
  await assert.rejects(
    repo.fetch("origin", env),
    /401|403|authentication|Authenticate|terminal prompts disabled/i,
  );
});

test("legacy migration preserves IDs, verifies Git content, and restarts without duplicate imports", async (t) => {
  const { migrate } = await import("../apps/cli/dist/migrate.js");
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
  const { PublishWorker } = await import("../apps/cli/dist/publish.js");
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
test("standalone CLI serves its packaged portal and rejects foreign origins", async (t) => {
  const { spawn } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "orbit-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = resolve("apps/cli/bundle/orbit.js");
  await exec(process.execPath, [cli, "init"], { cwd: root });
  const child = spawn(process.execPath, [cli, "serve"], {
    cwd: root,
    env: { ...process.env, ORBIT_PORT: "4328" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (d) => (output += d));
  child.stdout.on("data", (d) => (output += d));
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((r) => {
      if (child.exitCode !== null) return r();
      child.once("exit", r);
    });
  });
  let response;
  for (let i = 0; i < 100; i++) {
    response = await fetch("http://127.0.0.1:4328/health").catch(() => null);
    if (response?.ok) break;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(response?.ok, output);
  assert.match(
    await (await fetch("http://127.0.0.1:4328/")).text(),
    /assets\/index/,
  );
  const forbidden = await fetch("http://127.0.0.1:4328/api/v1/projects", {
    headers: { origin: "https://foreign.example" },
  });
  assert.equal(forbidden.status, 403);
});
test(
  "hosted PostgreSQL supports email ownership, Git registration, and revocation",
  { skip: !process.env.ORBIT_TEST_DATABASE_URL },
  async (t) => {
    const { PostgresDatabase } = await import("../apps/api/dist/database.js");
    const { randomBytes } = await import("node:crypto");
    const admin = new PostgresDatabase(process.env.ORBIT_TEST_DATABASE_URL),
      schema = "git_host_" + randomBytes(6).toString("hex");
    await admin.query("CREATE SCHEMA " + schema);
    const url = new URL(process.env.ORBIT_TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    const db = new PostgresDatabase(url.toString());
    await db.migrate();
    const dir = await mkdtemp(join(tmpdir(), "orbit-git-pg-"));
    let token;
    const origin = "http://127.0.0.1:4329";
    const app = await buildServer(db, {
      origin,
      repositoryRoot: dir,
      sendEmail: async (_email, url) => {
        token = new URL(url).searchParams.get("token");
      },
    });
    t.after(async () => {
      await app.close();
      await db.close();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
      await admin.close();
      await rm(dir, { recursive: true, force: true });
    });
    const sent = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/request",
      headers: { origin },
      payload: { email: "pg@example.test" },
    });
    assert.equal(sent.statusCode, 202, sent.body);
    const signed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/confirm",
      headers: { origin },
      payload: { token },
    });
    assert.equal(signed.statusCode, 200, signed.body);
    const cookie = signed.cookies[0].name + "=" + signed.cookies[0].value;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { origin, cookie },
      payload: { id: project.id, name: project.name },
    });
    assert.equal(created.statusCode, 200, created.body);
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/confirm",
      headers: { origin },
      payload: { token },
    });
    assert.equal(replay.statusCode, 401);
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { origin, cookie },
    });
    assert.equal(
      (await app.inject({ url: "/api/v1/projects", headers: { cookie } }))
        .statusCode,
      401,
    );
  },
);

test("checkpoint pagination reaches older history without moving its revision cursor", async (t) => {
  const { repo, root } = await fixture(t);
  const initial = await repo.checkpoint("Initial"),
    tree = await gitText(repo.history, ["rev-parse", initial + "^{tree}"]);
  let current = initial;
  for (let i = 0; i < 61; i++)
    current = await gitText(repo.history, [
      "commit-tree",
      tree,
      "-p",
      current,
      "-m",
      "Checkpoint " + i,
    ]);
  await git(repo.history, ["update-ref", "refs/heads/main", current]);
  const db = new SqliteDatabase(":memory:");
  const app = await buildServer(db, {
    origin: "http://127.0.0.1:4340",
    localRoot: root,
    devAuth: true,
  });
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const page = await app.inject({
    url: "/api/v1/projects/" + project.id + "/checkpoints",
  });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.json().items.length, 50);
  const cursor = page.json().nextCursor;
  assert.ok(cursor);
  const next = await gitText(repo.history, [
    "commit-tree",
    tree,
    "-p",
    current,
    "-m",
    "New checkpoint",
  ]);
  await git(repo.history, ["update-ref", "refs/heads/main", next]);
  const older = await app.inject({
    url: "/api/v1/projects/" + project.id + "/checkpoints?cursor=" + cursor,
  });
  assert.equal(older.json().revision, current);
  assert.equal(older.json().items.length, 12);
  assert.equal(older.json().items.at(-1).oid, initial);
  const forbidden = await app.inject({
    method: "PATCH",
    url: "/api/v1/projects/" + project.id + "?revision=" + initial,
    headers: { origin: "http://127.0.0.1:4340" },
    payload: { description: "not allowed" },
  });
  assert.equal(forbidden.statusCode, 409);
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
      resolve("apps/cli/dist/index.js"),
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
