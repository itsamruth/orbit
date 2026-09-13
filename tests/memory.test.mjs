import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { GitRepository, readSnapshot } from "../dist/storage/git/index.js";
import {
  importHistoricalSessions,
  listImportCandidates,
  probeProvider,
  setIntelligenceSettings,
  summarizeSession,
} from "../dist/intelligence/memory.js";
import { searchIndex } from "../dist/intelligence/search.js";
import { buildPublishProjection } from "../dist/publishing/worker.js";

const exec = promisify(execFile);
const cli = resolve("bin/orbit.js");

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "orbit-memory-"));
  const root = join(base, "project");
  await mkdir(root);
  await exec("git", ["init", "--initial-branch=main"], { cwd: root });
  await exec(process.execPath, [cli, "init"], { cwd: root });
  const config = JSON.parse(
    await import("node:fs/promises").then((fs) =>
      fs.readFile(join(root, ".orbit", "project.json"), "utf8"),
    ),
  );
  const repo = await GitRepository.open(root);
  t.after(async () => {
    await repo.db.close();
    await rm(base, { recursive: true, force: true });
  });
  return { base, root, repo, projectId: config.projectId };
}

test("historical Codex import is approved, idempotent, searchable, and private by default", async (t) => {
  const { base, root, repo, projectId } = await fixture(t);
  const codex = join(base, "codex");
  const sessions = join(codex, "sessions", "2026", "01", "01");
  await mkdir(sessions, { recursive: true });
  const nativeId = "11111111-1111-4111-8111-111111111111";
  await writeFile(
    join(sessions, "session.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00.000Z",
        type: "session_meta",
        payload: { id: nativeId, cwd: root, git: { branch: "main" } },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fix the refresh token race" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Use a single-flight refresh lock" },
          ],
        },
      }),
    ].join("\n") + "\n",
  );
  const prior = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codex;
  t.after(() => {
    if (prior === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prior;
  });
  const candidates = await listImportCandidates(repo, projectId, root, "codex");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].importState, "new");
  const imported = await importHistoricalSessions(repo, projectId, root, [
    candidates[0].id,
  ]);
  assert.equal(imported.sessions[0].captureMode, "imported");
  assert.equal(
    (await listImportCandidates(repo, projectId, root, "codex"))[0].importState,
    "current",
  );
  const snapshot = await readSnapshot(repo.history);
  const indexed = await import("../dist/storage/git/index.js").then(
    ({ snapshotRepository }) => snapshotRepository(repo.history),
  );
  t.after(() => indexed.db.close());
  const found = await searchIndex(indexed.repo, projectId, snapshot.revision, {
    query: "refresh token",
  });
  assert.equal(found.items.length, 1);
  assert.equal(await repo.state("publish:selected:sessions"), null);
});

test("authenticated provider creates evidence-bound summary and cache hit", async (t) => {
  const { base, root, repo, projectId } = await fixture(t);
  const bin = join(base, "bin");
  await mkdir(bin);
  const fake = join(bin, "codex");
  await writeFile(
    fake,
    `#!/usr/bin/env node
const a=process.argv.slice(2);if(a[0]==='--version')console.log('codex-cli test');else if(a[0]==='login')console.log('Logged in');else if(a[0]==='exec'&&a.includes('--help'))console.log('--ephemeral --output-schema');else if(a[0]==='exec'){let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const id=(s.match(/"id":"([^"]+)"/)||[])[1];console.log(JSON.stringify({title:'Refresh safely',overview:'A refresh race was resolved.',objectives:['Fix refresh'],decisions:[{text:'Use one lock',evidenceEventIds:[id]}],rejectedApproaches:[],openQuestions:[],tasks:[],files:[]}));});}else process.exit(1);`,
  );
  await chmod(fake, 0o700);
  const oldPath = process.env.PATH;
  process.env.PATH = bin + ":" + oldPath;
  t.after(() => {
    process.env.PATH = oldPath;
  });
  const now = new Date().toISOString();
  const workstream = {
    id: "work_summary",
    projectId,
    title: "Refresh",
    branch: "main",
    createdAt: now,
    updatedAt: now,
  };
  const session = {
    id: "sess_summary",
    projectId,
    workstreamId: workstream.id,
    agent: "codex",
    nativeSessionId: "native",
    status: "ended",
    startedAt: now,
    endedAt: now,
    captureMode: "live",
  };
  const event = {
    schemaVersion: 1,
    id: "evt_summary",
    projectId,
    workstreamId: workstream.id,
    sessionId: session.id,
    sequence: 0,
    occurredAt: now,
    payload: { type: "user_message", text: "Fix refresh" },
  };
  await repo.put(projectId, "workstream", workstream);
  await repo.put(projectId, "session", session);
  await repo.put(projectId, "event", event);
  await repo.checkpoint("Summary fixture");
  await setIntelligenceSettings(repo, {
    provider: "codex",
    autoSummarize: true,
    maxInputBytes: 48000,
  });
  assert.equal((await probeProvider("codex")).status, "ready");
  const first = await summarizeSession(repo, projectId, session.id);
  const second = await summarizeSession(repo, projectId, session.id);
  assert.equal(first.id, second.id);
  assert.deepEqual(first.decisions[0].evidenceEventIds, [event.id]);
});

test("publish projection never contains an unselected session", async (t) => {
  const { repo, projectId } = await fixture(t);
  const now = new Date().toISOString();
  const workstream = {
    id: "work_publish",
    projectId,
    title: "Publish",
    branch: "main",
    createdAt: now,
    updatedAt: now,
  };
  await repo.put(projectId, "workstream", workstream);
  for (const id of ["sess_public", "sess_private"])
    await repo.put(projectId, "session", {
      id,
      projectId,
      workstreamId: workstream.id,
      agent: "codex",
      nativeSessionId: id,
      status: "ended",
      startedAt: now,
      endedAt: now,
      captureMode: "live",
    });
  await repo.checkpoint("Two sessions");
  await repo.setState(
    "publish:selected:sessions",
    JSON.stringify(["sess_public"]),
  );
  const projection = await buildPublishProjection(repo);
  t.after(() => projection.db.close());
  const snapshot = await readSnapshot(projection.history);
  assert.ok(
    snapshot.records.some((record) => record.data.id === "sess_public"),
  );
  assert.ok(
    !snapshot.records.some((record) => record.data.id === "sess_private"),
  );
  const objects = await exec("git", ["rev-list", "--objects", "--all"], {
    cwd: projection.history,
  });
  assert.doesNotMatch(objects.stdout, /sess_private/);
});
