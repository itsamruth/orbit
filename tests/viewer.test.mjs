import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { initProject } from "../dist/project/index.js";
import { GitRepository } from "../dist/storage/git/index.js";
import { registerProject } from "../dist/viewer/registry.js";
import { startViewer, VIEWER_PROTOCOL } from "../dist/viewer/server.js";

const exec = promisify(execFile);
const bin = resolve("bin/orbit.js");
const assets = resolve("dist/ui");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "orbit-viewer-"));
  const previous = process.env.ORBIT_VIEWER_HOME;
  process.env.ORBIT_VIEWER_HOME = join(root, "viewer-home");
  const { config } = await initProject(root);
  const repo = await GitRepository.open(root, true);
  const pid = config.projectId,
    now = "2026-09-13T00:00:00.000Z";
  await repo.put(pid, "project", {
    id: pid,
    name: "Viewer fixture",
    description: "Local conversations",
    repository: null,
    owner: "local",
    createdAt: now,
    updatedAt: now,
    cloudSyncEnabled: false,
    excludedPaths: [],
  });
  await repo.put(pid, "workstream", {
    id: "work_viewer",
    projectId: pid,
    title: "Untitled workstream",
    titleSource: "automatic",
    branch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await repo.put(pid, "session", {
    id: "sess_viewer",
    projectId: pid,
    workstreamId: "work_viewer",
    agent: "claude",
    nativeSessionId: "fixture-native",
    status: "active",
    startedAt: now,
    endedAt: null,
  });
  const event = (sequence, payload) => ({
    schemaVersion: 2,
    id: "evt_" + sequence,
    projectId: pid,
    workstreamId: "work_viewer",
    sessionId: "sess_viewer",
    sequence,
    occurredAt: new Date(Date.parse(now) + sequence * 1000).toISOString(),
    source: {
      adapter: "claude",
      normalizerVersion: 2,
      nativeVersion: "fixture",
      recordId: "record_" + sequence,
      offset: sequence,
      blockIndex: 0,
    },
    payload,
  });
  await repo.capture(pid, "fixture", 121, [
    ...Array.from({ length: 120 }, (_, index) =>
      event(index + 1, {
        type: "user_message",
        text: "Message " + (index + 1),
      }),
    ),
    event(121, {
      type: "runtime_context",
      reason: "Orbit bootstrap must stay hidden",
    }),
  ]);
  const checkpoint = await repo.checkpoint("Before live updates");
  await registerProject(root, pid);
  const server = await startViewer({ port: 0, assets });
  const url = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
    await repo.db.close();
    if (previous === undefined) delete process.env.ORBIT_VIEWER_HOME;
    else process.env.ORBIT_VIEWER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });
  const get = async (path, init) => {
    const response = await fetch(url + path, init);
    return { status: response.status, body: await response.json() };
  };
  return { root, repo, pid, event, checkpoint, get, url };
}

test("local dashboard reads live captured history without publishing, preserves chunks, and paginates older events", async (t) => {
  const { repo, pid, event, get, checkpoint } = await fixture(t);
  const base = "/api/v1/projects/" + pid;
  const first = await get("/api/v1/projects");
  assert.equal(first.status, 200);
  assert.equal(first.body.items[0].id, pid);
  assert.equal(first.body.unavailable.length, 0);
  assert.equal(
    (await get(base + "/workstreams")).body.items[0].title,
    "Message 1",
  );

  await repo.capture(pid, "fixture", 122, [
    event(122, { type: "assistant_message", text: "Latest captured reply" }),
  ]);
  const latest = await get(base + "/sessions/sess_viewer/events");
  assert.equal(latest.body.items.at(-1).payload.text, "Latest captured reply");
  assert.equal(latest.body.items.length, 50);
  let items = [...latest.body.items],
    cursor = latest.body.nextCursor;
  while (cursor) {
    const older = await get(
      base + "/sessions/sess_viewer/events?cursor=" + cursor,
    );
    items = [...older.body.items, ...items];
    cursor = older.body.nextCursor;
  }
  assert.equal(items.length, 121);
  assert.equal(new Set(items.map((item) => item.id)).size, 121);
  assert.equal(items[0].id, "evt_1");
  assert.ok(items.every((item) => item.payload.type !== "runtime_context"));
  assert.equal(
    (await get(base + "/sessions/sess_viewer/events?cursor=foreign")).status,
    400,
  );
  assert.equal((await get(base + "/sessions/missing/events")).status, 404);
  assert.equal(
    (await get(base + "/search?q=Latest%20captured")).body.items[0].id,
    "evt_122",
  );
  assert.equal((await get(base + "/search?q=bootstrap")).body.items.length, 0);
  const historical = await get(
    base + "/sessions/sess_viewer/events?revision=" + checkpoint,
  );
  assert.equal(historical.body.items.at(-1).id, "evt_120");
  assert.equal(
    (
      await get(base + "/sessions/sess_viewer/events?revision=main")
    ).body.items.at(-1).id,
    "evt_122",
  );

  const text = "Oversized output ".repeat(18000);
  const payload = JSON.stringify({
    type: "tool_result",
    callId: "tool_1",
    output: text,
    failed: false,
    status: "unknown",
  });
  const middle = Math.floor(payload.length / 2);
  await repo.capture(pid, "fixture", 124, [
    {
      ...event(123, { type: "content_chunk", text: payload.slice(0, middle) }),
      chunk: { groupId: "evt_long", index: 0, total: 2 },
    },
    {
      ...event(124, { type: "content_chunk", text: payload.slice(middle) }),
      chunk: { groupId: "evt_long", index: 1, total: 2 },
    },
  ]);
  const reconstructed = (
    await get(base + "/sessions/sess_viewer/events")
  ).body.items.at(-1);
  assert.equal(reconstructed.id, "evt_long");
  assert.equal(reconstructed.payload.output, text);
  assert.equal(reconstructed.payload.status, "unknown");
  assert.equal(await repo.state("publish:enabled"), null);
});

test("local dashboard serves its copied UI, rejects remote origins and mutations, and leaves history unchanged", async (t) => {
  const { repo, pid, get, url } = await fixture(t);
  const before = await repo.db.query(
    "SELECT data FROM orbit_entities ORDER BY id",
  );
  assert.equal(
    (await get("/api/v1/viewer/health")).body.service,
    VIEWER_PROTOCOL,
  );
  const page = await fetch(url + "/projects/" + pid);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Orbit/);
  const script = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(url + script)).status, 200);
  assert.equal((await fetch(url + "/fonts/geist-latin.woff2")).status, 200);
  assert.equal(
    (
      await get("/api/v1/projects", {
        headers: { Origin: "https://example.com" },
      })
    ).status,
    403,
  );
  const hostileHostStatus = await new Promise((done, reject) => {
    const request = httpRequest(
      url + "/api/v1/projects",
      { headers: { Host: "attacker.example:" + new URL(url).port } },
      (response) => {
        response.resume();
        done(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal(
    (await get("/api/v1/projects", { headers: { Origin: url } })).status,
    200,
  );
  assert.equal(
    (await get("/api/v1/projects/" + pid, { method: "DELETE" })).status,
    405,
  );
  assert.equal(
    (await get("/api/v1/viewer/stop", { method: "POST" })).status,
    403,
  );
  assert.equal((await get("/api/v1/me")).status, 404);
  assert.equal(
    (await get("/api/v1/auth/login", { method: "POST" })).status,
    405,
  );
  assert.equal((await get("/api/v1/projects/unknown")).status, 404);
  assert.deepEqual(
    await repo.db.query("SELECT data FROM orbit_entities ORDER BY id"),
    before,
  );
});

test("orbit init starts one shared local viewer and dashboard stop shuts it down", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orbit-viewer-process-"));
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const env = {
    ...process.env,
    ORBIT_VIEWER: "1",
    ORBIT_VIEWER_HOME: join(root, "registry"),
    ORBIT_VIEWER_PORT: String(port),
  };
  const options = { cwd: root, env, timeout: 20000 };
  t.after(async () => {
    await exec(process.execPath, [bin, "dashboard", "--stop"], options).catch(
      () => {},
    );
    await rm(root, { recursive: true, force: true });
  });
  await exec(process.execPath, [bin, "init"], options);
  const url = "http://127.0.0.1:" + port;
  assert.equal((await fetch(url + "/api/v1/viewer/health")).status, 200);
  const opened = await exec(
    process.execPath,
    [bin, "dashboard", "--no-open"],
    options,
  );
  assert.match(opened.stdout, new RegExp(String(port)));
  const projects = await fetch(url + "/api/v1/projects").then((response) =>
    response.json(),
  );
  assert.equal(projects.items.length, 1);
  const config = JSON.parse(
    await readFile(join(root, ".orbit", "project.json"), "utf8"),
  );
  assert.equal(projects.items[0].id, config.projectId);
  const stopped = await exec(
    process.execPath,
    [bin, "dashboard", "--stop"],
    options,
  );
  assert.match(stopped.stdout, /stopped/);
  const stoppedAgain = await exec(
    process.execPath,
    [bin, "dashboard", "--stop"],
    options,
  );
  assert.match(stoppedAgain.stdout, /not running/);
});
