import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteDatabase, Repository } from "../dist/storage/journal/index.js";
import { PolicyFilter, defaultPolicy, redact } from "../dist/security/index.js";
import { buildContext } from "../dist/sessions/handoff/index.js";
import { readRecords, normalizeBatch } from "../dist/adapters/shared/index.js";
import { codexAdapter, normalizeCodex } from "../dist/adapters/codex/index.js";
import { normalizeClaude } from "../dist/adapters/claude/index.js";
import { randomUUID } from "node:crypto";
const now = new Date().toISOString();
const project = (id = "prj_test") => ({
  id,
  name: "test",
  owner: "owner",
  description: "",
  repository: null,
  createdAt: now,
  updatedAt: now,
  cloudSyncEnabled: true,
  excludedPaths: defaultPolicy.excludedPaths,
});
const work = (pid = "prj_test", id = "work_test") => ({
  id,
  projectId: pid,
  title: "Build OAuth",
  branch: "main",
  createdAt: now,
  updatedAt: now,
});
const session = (pid = "prj_test", wid = "work_test", id = "sess_test") => ({
  id,
  projectId: pid,
  workstreamId: wid,
  agent: "codex",
  nativeSessionId: "native_test",
  status: "active",
  startedAt: now,
  endedAt: null,
});
const event = (
  sequence = 0,
  payload = { type: "user_message", text: "Implement OAuth" },
) => ({
  schemaVersion: 1,
  id: "evt_" + sequence,
  projectId: "prj_test",
  workstreamId: "work_test",
  sessionId: "sess_test",
  sequence,
  occurredAt: now,
  payload,
});
const op = (kind, data) => ({
  id: "op_" + randomUUID(),
  kind,
  entityId: data.id,
  action: "put",
  data,
});
async function local(t) {
  const db = new SqliteDatabase(":memory:");
  t.after(() => db.close());
  const repo = new Repository(db);
  await repo.put("prj_test", "project", project(), false);
  await repo.put("prj_test", "workstream", work(), false);
  await repo.put("prj_test", "session", session(), false);
  return { db, repo };
}
test("capture transaction rolls back events, outbox, and offset together", async (t) => {
  const { repo } = await local(t);
  await repo.capture("prj_test", "source", 10, [event()]);
  await assert.rejects(
    repo.capture("prj_test", "source", 20, [
      event(1),
      { ...event(), payload: { type: "user_message", text: "conflict" } },
    ]),
    /Operation ID/,
  );
  assert.equal(await repo.offset("source"), 10);
  assert.equal((await repo.list("prj_test", "event")).length, 1);
  assert.equal((await repo.pending("prj_test")).length, 1);
});
test("duplicate replay is idempotent; changed operation content is rejected", async (t) => {
  const { repo } = await local(t);
  await repo.capture("prj_test", "source", 10, [event()]);
  await repo.capture("prj_test", "source", 10, [event()]);
  assert.equal((await repo.list("prj_test", "event")).length, 1);
  await assert.rejects(
    repo.capture("prj_test", "source", 10, [
      { ...event(), payload: { type: "user_message", text: "changed" } },
    ]),
    /Operation ID/,
  );
});
test("events cannot cross project or workstream boundaries", async (t) => {
  const { repo } = await local(t);
  await repo.put("prj_test", "workstream", work("prj_test", "work_other"));
  await assert.rejects(
    repo.put("prj_test", "event", { ...event(), workstreamId: "work_other" }),
    /ownership mismatch/,
  );
  await assert.rejects(
    repo.put("prj_test", "event", { ...event(), projectId: "prj_other" }),
    /Project mismatch/,
  );
});
test("deleting workstream cascades and rejects future descendant uploads", async (t) => {
  const { repo } = await local(t);
  await repo.put("prj_test", "event", event());
  await repo.remove("prj_test", "workstream", "work_test");
  assert.equal(await repo.get("prj_test", "session", "sess_test"), null);
  assert.equal((await repo.list("prj_test", "event")).length, 0);
  await assert.rejects(repo.put("prj_test", "event", event(1)), /deleted/);
});
test("cannot delete another project entity by guessing its ID", async (t) => {
  const { repo } = await local(t);
  await repo.put("prj_other", "project", project("prj_other"));
  await repo.put("prj_other", "workstream", work("prj_other", "work_other"));
  await assert.rejects(
    repo.remove("prj_test", "workstream", "work_other"),
    /not found/,
  );
  assert.ok(await repo.get("prj_other", "workstream", "work_other"));
});
test("redaction covers structured secrets, command output, and key blocks", () => {
  assert.equal(
    redact("password=hello secret:abcd"),
    "password=[REDACTED] secret:[REDACTED]",
  );
  const filter = new PolicyFilter();
  const result = filter.apply(
    event(0, {
      type: "tool_call",
      callId: "a",
      name: "request",
      input: {
        authorization: "Bearer private-value",
        nested: { password: "xyz" },
      },
    }),
    defaultPolicy,
  );
  assert.equal(result.action, "keep");
  assert.equal(result.event.payload.input.authorization, "[REDACTED]");
  assert.equal(result.event.payload.input.nested.password, "[REDACTED]");
  assert.equal(
    redact("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"),
    "[REDACTED PRIVATE KEY]",
  );
});
test("excluded tool results stay excluded after filter recovery", () => {
  const filter = new PolicyFilter();
  assert.equal(
    filter.apply(
      event(0, {
        type: "tool_call",
        callId: "a",
        name: "read_file",
        input: { path: ".env" },
      }),
      defaultPolicy,
    ).action,
    "drop",
  );
  const restored = new PolicyFilter();
  restored.restore(filter.snapshot());
  assert.equal(
    restored.apply(
      event(1, {
        type: "tool_result",
        callId: "a",
        output: "CUSTOMER_SECRET_VALUE",
        failed: false,
      }),
      defaultPolicy,
    ).action,
    "drop",
  );
});
test("handoff keeps original/latest objectives and complete tool pairs within budget", () => {
  const events = [
    event(0),
    event(1, { type: "assistant_message", text: "x".repeat(10000) }),
    event(2, { type: "tool_call", callId: "a", name: "test", input: {} }),
    event(3, {
      type: "tool_result",
      callId: "a",
      output: "passed",
      failed: false,
    }),
    event(4, { type: "user_message", text: "Now test expiry" }),
  ];
  const { context, truncated } = buildContext(
    events,
    { root: "/repo", branch: "main", head: null, porcelain: "", dirty: false },
    2500,
  );
  assert.ok(Buffer.byteLength(context) <= 2500);
  assert.equal(truncated, true);
  assert.match(context, /Implement OAuth/);
  assert.match(context, /Now test expiry/);
  assert.match(context, /tool_call/);
  assert.match(context, /tool_result/);
});
test("oversize objective uses an explicit excerpt while keeping context bounded", () => {
  const { context, truncated } = buildContext([event(0, { type: "user_message", text: "x".repeat(10000) })], { root: "/repo", branch: null, head: null, porcelain: "", dirty: false }, 2048);
  assert.ok(Buffer.byteLength(context) <= 2048);
  assert.equal(truncated, true);
  assert.match(context, /excerpt/);
});
test("JSONL reader waits for partial records and preserves UTF-8 byte offsets", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "orbit-jsonl-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "native.jsonl");
  const complete = JSON.stringify({ message: "你好" }) + "\n";
  await writeFile(path, complete + '{"incomplete":');
  const first = await readRecords(path, 0);
  assert.equal(first.records.length, 1);
  assert.equal(first.position, Buffer.byteLength(complete));
  await writeFile(path, '{"incomplete":true}\n', { flag: "a" });
  const second = await readRecords(path, first.position);
  assert.equal(second.malformed, 1);
  await writeFile(path, "");
  await assert.rejects(readRecords(path, first.position), /truncated/);
});
test("native normalization is vendor-independent and replay IDs remain stable", () => {
  const raw = {
    type: "response_item",
    timestamp: now,
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hello" }],
    },
  };
  assert.deepEqual(normalizeCodex(raw), [
    { type: "user_message", text: "Hello" },
  ]);
  assert.deepEqual(
    normalizeClaude({ type: "user", message: { content: "Hello" } }),
    [{ type: "user_message", text: "Hello" }],
  );
  const identity = {
    projectId: "prj_test",
    workstreamId: "work_test",
    sessionId: "sess_test",
  };
  assert.deepEqual(
    normalizeBatch(
      codexAdapter,
      identity,
      [{ value: raw, offset: 123 }],
      0,
      now,
    ),
    normalizeBatch(
      codexAdapter,
      identity,
      [{ value: raw, offset: 123 }],
      0,
      now,
    ),
  );
  assert.deepEqual(
    normalizeCodex({
      type: "event_msg",
      payload: { type: "user_message", message: "Hello" },
    }),
    [],
  );
});

test("recovery drains complete records and retains exclusion state across crashes", async (t) => {
  const { recoverCapture } = await import("../dist/sessions/runtime.js");
  const { repo } = await local(t);
  const dir = await mkdtemp(join(tmpdir(), "orbit-recover-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "native.jsonl");
  const call = {
    timestamp: now,
    type: "response_item",
    payload: {
      type: "function_call",
      call_id: "secret-read",
      name: "read_file",
      arguments: JSON.stringify({ path: ".env" }),
    },
  };
  const initial = JSON.stringify(call) + "\n";
  await writeFile(path, initial);
  await repo.setState(
    "native:sess_test",
    JSON.stringify({ id: "native_test", projectRoot: dir, path }),
  );
  await repo.capture("prj_test", path, Buffer.byteLength(initial), [], {
    key: "filter:sess_test",
    value: JSON.stringify(["sess_test:secret-read"]),
  });
  await writeFile(
    path,
    JSON.stringify({
      timestamp: now,
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "secret-read",
        output: "PRIVATE_RESULT",
      },
    }) +
      "\n" +
      JSON.stringify({
        timestamp: now,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Continue testing" }],
        },
      }) +
      "\n",
    { flag: "a" },
  );
  await recoverCapture(repo, "prj_test", session());
  const events = await repo.list("prj_test", "event");
  assert.equal(events.length, 2);
  assert.equal(events[0].payload.type, "coverage");
  assert.equal(events[1].payload.text, "Continue testing");
  assert.equal(
    JSON.stringify(await repo.pending("prj_test")).includes("PRIVATE_RESULT"),
    false,
  );
  await recoverCapture(repo, "prj_test", session());
  assert.equal((await repo.list("prj_test", "event")).length, 2);
});
test("handoff query bounds history while retaining original and latest user requests", async (t) => {
  const { repo } = await local(t);
  for (let i = 0; i < 300; i++)
    await repo.put(
      "prj_test",
      "event",
      event(i, {
        type: i === 0 || i === 10 ? "user_message" : "assistant_message",
        text:
          i === 0
            ? "Original objective"
            : i === 10
              ? "Latest objective"
              : "progress " + i,
      }),
      false,
    );
  const bounded = await repo.handoffEvents("prj_test", "work_test");
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.events.length <= 258);
  assert.equal(bounded.events[0].payload.text, "Original objective");
  assert.ok(bounded.events.some((e) => e.payload.text === "Latest objective"));
  const result = buildContext(
    bounded.events,
    { root: "/repo", branch: null, head: null, porcelain: "", dirty: false },
    48000,
    bounded.truncated,
  );
  assert.equal(result.truncated, true);
});
