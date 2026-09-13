import { createRequire as orbitCreateRequire } from "node:module"; const require = orbitCreateRequire(import.meta.url);
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// packages/local-store/dist/database.js
import Database from "better-sqlite3";
var init_database = __esm({
  "packages/local-store/dist/database.js"() {
    "use strict";
  }
});

// packages/local-store/dist/repository.js
import { createHash, randomUUID } from "node:crypto";
function validateEntity(kind, value, projectId) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Invalid entity");
  const o = value;
  id(o, "id");
  const fields = {
    project: [
      "id",
      "name",
      "description",
      "repository",
      "owner",
      "createdAt",
      "updatedAt",
      "cloudSyncEnabled",
      "excludedPaths"
    ],
    workstream: [
      "id",
      "projectId",
      "title",
      "branch",
      "createdAt",
      "updatedAt"
    ],
    session: [
      "id",
      "projectId",
      "workstreamId",
      "agent",
      "nativeSessionId",
      "origin",
      "status",
      "startedAt",
      "endedAt",
      "captureMode",
      "importedAt",
      "sourceFingerprint"
    ],
    event: [
      "schemaVersion",
      "id",
      "projectId",
      "workstreamId",
      "sessionId",
      "sequence",
      "occurredAt",
      "payload"
    ],
    summary: [
      "schemaVersion",
      "id",
      "projectId",
      "workstreamId",
      "sessionId",
      "provider",
      "providerVersion",
      "model",
      "promptVersion",
      "sourceHash",
      "generatedAt",
      "coverage",
      "title",
      "overview",
      "objectives",
      "decisions",
      "rejectedApproaches",
      "openQuestions",
      "tasks",
      "files"
    ]
  };
  if (Object.keys(o).some((key) => !fields[kind].includes(key)))
    fail("Unexpected entity field");
  const timestamp = (key) => {
    if (typeof o[key] !== "string" || !Number.isFinite(Date.parse(o[key])))
      fail("Invalid " + key);
  };
  if (kind === "project" || kind === "workstream") {
    timestamp("createdAt");
    timestamp("updatedAt");
  }
  if (kind === "session") {
    timestamp("startedAt");
    if (o.endedAt !== null)
      timestamp("endedAt");
  }
  if (kind === "event")
    timestamp("occurredAt");
  if (kind === "project") {
    if (o.id !== projectId)
      fail("Project mismatch");
    text(o, "name", 120);
    text(o, "owner", 120);
    if (typeof o.description !== "string" || o.description.length > 2e3 || typeof o.cloudSyncEnabled !== "boolean" || !Array.isArray(o.excludedPaths) || o.excludedPaths.length > 100 || !o.excludedPaths.every((x) => typeof x === "string" && x.length <= 300))
      fail("Invalid project settings");
  } else {
    if (o.projectId !== projectId)
      fail("Project mismatch");
  }
  if (kind === "workstream") {
    text(o, "title", 200);
    if (o.branch !== null && typeof o.branch !== "string")
      fail("Invalid branch");
  }
  if (kind === "session") {
    id(o, "workstreamId");
    text(o, "nativeSessionId", 200);
    if (o.origin !== void 0) {
      const origin = o.origin;
      if (!origin || typeof origin !== "object" || typeof origin.checkpoint !== "string" || !/^[a-f0-9]{40,64}$/.test(origin.checkpoint))
        fail("Invalid continuation origin");
      id(origin, "workstreamId");
    }
    text(o, "agent", 100);
    text(o, "startedAt", 100);
    if (!["active", "paused", "ended", "interrupted"].includes(o.status))
      fail("Invalid session status");
    if (o.captureMode !== void 0 && !["live", "imported"].includes(o.captureMode))
      fail("Invalid capture mode");
    if (o.importedAt !== void 0)
      timestamp("importedAt");
    if (o.sourceFingerprint !== void 0 && (typeof o.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(o.sourceFingerprint)))
      fail("Invalid source fingerprint");
  }
  if (kind === "event") {
    id(o, "workstreamId");
    id(o, "sessionId");
    if (o.schemaVersion !== 1 || !Number.isSafeInteger(o.sequence) || o.sequence < 0)
      fail("Invalid event sequence or schema");
    text(o, "occurredAt", 100);
    const p = o.payload;
    if (!p || typeof p !== "object")
      fail("Invalid event payload");
    const payloadFields = {
      user_message: ["type", "text"],
      assistant_message: ["type", "text"],
      tool_call: ["type", "callId", "name", "input"],
      tool_result: ["type", "callId", "output", "failed"],
      command: ["type", "command", "exitCode"],
      file_modified: ["type", "path"],
      git_state: ["type", "workspace"],
      session_ended: ["type", "reason"]
    };
    if (!payloadFields[String(p.type)] || Object.keys(p).some((key) => !payloadFields[String(p.type)].includes(key)))
      fail("Unsupported event fields");
    switch (p.type) {
      case "user_message":
      case "assistant_message":
        if (typeof p.text !== "string")
          fail("Invalid message");
        break;
      case "tool_call":
        text(p, "callId", 200);
        text(p, "name", 200);
        if (!("input" in p))
          fail("Missing tool input");
        break;
      case "tool_result":
        text(p, "callId", 200);
        if (typeof p.output !== "string" || typeof p.failed !== "boolean")
          fail("Invalid tool result");
        break;
      case "command":
        text(p, "command", 2e5);
        if (p.exitCode !== null && !Number.isInteger(p.exitCode))
          fail("Invalid exit code");
        break;
      case "file_modified":
        text(p, "path", 1e4);
        break;
      case "git_state": {
        const w = p.workspace;
        if (!w || typeof w.root !== "string" || typeof w.porcelain !== "string" || typeof w.dirty !== "boolean" || w.branch !== null && typeof w.branch !== "string" || w.head !== null && typeof w.head !== "string")
          fail("Invalid workspace");
        break;
      }
      case "session_ended":
        text(p, "reason", 1e3);
        break;
      default:
        fail("Unsupported event type");
    }
  }
  if (kind === "summary") {
    id(o, "workstreamId");
    id(o, "sessionId");
    if (o.schemaVersion !== 1 || !["codex", "claude"].includes(o.provider) || !Number.isSafeInteger(o.promptVersion) || o.promptVersion < 1 || typeof o.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(o.sourceHash) || !["complete", "truncated"].includes(o.coverage))
      fail("Invalid summary metadata");
    timestamp("generatedAt");
    text(o, "providerVersion", 200);
    text(o, "title", 200);
    text(o, "overview", 2e4);
    if (o.model !== null && typeof o.model !== "string")
      fail("Invalid summary model");
    for (const key of ["objectives", "files"])
      if (!Array.isArray(o[key]) || !o[key].every((x) => typeof x === "string" && x.length <= 1e4))
        fail("Invalid summary " + key);
    for (const key of [
      "decisions",
      "rejectedApproaches",
      "openQuestions",
      "tasks"
    ]) {
      if (!Array.isArray(o[key]))
        fail("Invalid summary " + key);
      for (const item of o[key]) {
        if (!item || typeof item.text !== "string" || !Array.isArray(item.evidenceEventIds) || !item.evidenceEventIds.every((x) => typeof x === "string" && /^[a-zA-Z0-9_-]+$/.test(x)) || key === "tasks" && !["open", "done"].includes(item.status))
          fail("Invalid summary item");
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 256e3)
    fail("Entity exceeds 256 KB");
}
var DomainError, json, fingerprint, fail, text, id;
var init_repository = __esm({
  "packages/local-store/dist/repository.js"() {
    "use strict";
    DomainError = class extends Error {
      statusCode;
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
      }
    };
    json = (v) => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
    fingerprint = (v) => createHash("sha256").update(json(v)).digest("hex");
    fail = (message) => {
      throw new DomainError(400, message);
    };
    text = (o, key, max = 1e3) => {
      if (typeof o[key] !== "string" || !o[key].length || o[key].length > max)
        fail("Invalid " + key);
    };
    id = (o, key) => {
      text(o, key, 160);
      if (!/^[a-zA-Z0-9_-]+$/.test(o[key]))
        fail("Invalid " + key);
    };
  }
});

// packages/local-store/dist/index.js
var init_dist = __esm({
  "packages/local-store/dist/index.js"() {
    "use strict";
    init_database();
    init_repository();
  }
});

// packages/git-store/dist/git.js
import { spawn } from "node:child_process";
async function git(path, args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_"))
        delete env[key];
    if (process.env.ORBIT_RECEIVE_VALIDATE === "1") {
      for (const key of [
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_QUARANTINE_PATH"
      ])
        if (process.env[key])
          env[key] = process.env[key];
    }
    const child = spawn("git", [
      "-C",
      path,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "protocol.ext.allow=never",
      ...args
    ], {
      env: { ...env, GIT_TERMINAL_PROMPT: "0", ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });
    const out = [], err = [];
    let size = 0, failure;
    const timer = setTimeout(() => {
      failure = new Error("Git operation timed out");
      child.kill("SIGKILL");
    }, options.timeout ?? 3e4);
    child.stdout.on("data", (b) => {
      size += b.length;
      if (size > (options.maxBytes ?? 128 * 1024 * 1024)) {
        failure = new Error("Git output exceeds supported size");
        child.kill("SIGKILL");
      } else
        out.push(b);
    });
    child.stderr.on("data", (b) => {
      if (Buffer.concat(err).length < 64e3)
        err.push(b);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure)
        reject(failure);
      else if (code)
        reject(new DomainError(409, Buffer.concat(err).toString().trim() || "Git operation failed"));
      else
        resolve(Buffer.concat(out));
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(options.input);
  });
}
async function resolveRevision(path, revision = "HEAD") {
  if (!revision || revision.startsWith("-") || /[\x00-\x20]/.test(revision) || revision.length > 256)
    throw new DomainError(400, "Invalid revision");
  return gitText(path, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    revision + "^{commit}"
  ]);
}
var gitText;
var init_git = __esm({
  "packages/git-store/dist/git.js"() {
    "use strict";
    init_dist();
    gitText = async (path, args, options = {}) => (await git(path, args, options)).toString("utf8").trim();
  }
});

// packages/git-store/dist/index.js
init_dist();
init_git();

// packages/git-store/dist/snapshot.js
init_dist();
init_git();
import { createHash as createHash2 } from "node:crypto";
async function readSnapshot(path, ref = "HEAD") {
  const revision = await resolveRevision(path, ref);
  const entries = (await git(path, ["ls-tree", "-r", "-z", revision])).toString().split("\0").filter(Boolean).map((line) => {
    const [meta, name] = line.split("	");
    const [mode, type, oid] = meta.split(" ");
    if (mode !== "100644" || type !== "blob" || !name || !/^(orbit\.json|(?:workstreams|sessions|summarys)\/[a-zA-Z0-9_-]+\.json|events\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}\.jsonl)$/.test(name))
      throw new DomainError(400, "Unsupported repository entry: " + name);
    return { name, oid };
  });
  if (!entries.length || entries.length > 1e5)
    throw new DomainError(400, "Repository entry limit exceeded");
  const result = await git(path, ["cat-file", "--batch"], {
    input: entries.map((e) => e.oid).join("\n") + "\n"
  });
  const files = /* @__PURE__ */ new Map();
  let offset = 0;
  for (const entry of entries) {
    const nl = result.indexOf(10, offset);
    const [oid, type, count] = result.subarray(offset, nl).toString().split(" ");
    const length = Number(count);
    if (oid !== entry.oid || type !== "blob" || !Number.isSafeInteger(length) || length > 1024 * 1024)
      throw new DomainError(400, "Invalid or oversized conversation blob");
    const body = result.subarray(nl + 1, nl + 1 + length).toString();
    files.set(entry.name, body);
    offset = nl + 1 + length + 1;
  }
  const manifest = JSON.parse(files.get("orbit.json") ?? "null");
  if (![1, 2].includes(manifest?.formatVersion) || !manifest.project)
    throw new DomainError(400, "Unsupported Orbit repository format");
  const project = manifest.project;
  validateEntity("project", project, project.id);
  const records = [{ kind: "project", data: project }];
  const seen = /* @__PURE__ */ new Set([project.id]), sessions = /* @__PURE__ */ new Map(), works = /* @__PURE__ */ new Set(), seqs = /* @__PURE__ */ new Set();
  for (const kind of ["workstream", "session", "event", "summary"]) {
    for (const [name, body] of files) {
      if (!name.startsWith(kind === "event" ? "events/" : kind + "s/"))
        continue;
      if (kind === "event" && !name.endsWith(createHash2("sha256").update(body).digest("hex") + ".jsonl"))
        throw new DomainError(400, "Event chunk hash mismatch");
      const values = kind === "event" ? body.trimEnd().split("\n").map((s) => JSON.parse(s)) : [JSON.parse(body)];
      for (const data of values) {
        validateEntity(kind, data, project.id);
        if (seen.has(data.id))
          throw new DomainError(400, "Duplicate entity ID");
        seen.add(data.id);
        if (kind !== "event" && name !== kind + "s/" + data.id + ".json")
          throw new DomainError(400, "Entity path mismatch");
        if (kind === "workstream")
          works.add(data.id);
        if (kind === "session") {
          const s = data;
          if (!works.has(s.workstreamId))
            throw new DomainError(400, "Missing workstream");
          sessions.set(s.id, s);
        }
        if (kind === "event") {
          const e = data, s = sessions.get(e.sessionId);
          if (!s || s.workstreamId !== e.workstreamId || !name.startsWith("events/" + e.sessionId + "/"))
            throw new DomainError(400, "Invalid event parent");
          const key = e.sessionId + ":" + e.sequence;
          if (seqs.has(key))
            throw new DomainError(400, "Duplicate event sequence");
          seqs.add(key);
        }
        if (kind === "summary") {
          const summary = data;
          const session = sessions.get(summary.sessionId);
          if (!session || session.workstreamId !== summary.workstreamId)
            throw new DomainError(400, "Invalid summary parent");
        }
        records.push({ kind, data });
      }
    }
  }
  records.sort((a, b) => {
    const rank = { project: 0, workstream: 1, session: 2, event: 3, summary: 4 };
    if (a.kind !== b.kind)
      return rank[a.kind] - rank[b.kind];
    if (a.kind === "event") {
      const x = a.data, y = b.data;
      return x.sessionId.localeCompare(y.sessionId) || x.sequence - y.sequence;
    }
    const date = (x) => "startedAt" in x ? x.startedAt : "createdAt" in x ? x.createdAt : "";
    return date(a.data).localeCompare(date(b.data)) || a.data.id.localeCompare(b.data.id);
  });
  return { project, records, revision };
}

// packages/git-store/dist/index.js
init_git();

// apps/api/src/receive-hook.ts
init_dist();
process.env.ORBIT_RECEIVE_VALIDATE = "1";
var input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const pid = process.argv[2];
  if (!pid) throw new Error("Missing repository identity");
  for (const line of input.trim().split("\n")) {
    const [old, next, ref] = line.split(" ");
    if (!old || !next || !ref || !ref.startsWith("refs/heads/") || /^0+$/.test(next))
      throw new Error(
        "Only conversation branch updates are allowed; deletion is disabled."
      );
    if (!/^0+$/.test(old)) {
      await gitText(process.cwd(), ["merge-base", "--is-ancestor", old, next]);
    }
    const commits = (await gitText(process.cwd(), [
      "rev-list",
      next,
      ...!/^0+$/.test(old) ? ["^" + old] : [],
      "--max-count=1001"
    ])).split("\n").filter(Boolean);
    if (commits.length > 1e3)
      throw new Error("Push at most 1000 new checkpoints at a time.");
    for (const oid of commits) {
      const snap = await readSnapshot(process.cwd(), oid);
      if (snap.project.id !== pid) throw new Error("Project identity mismatch");
      const parent = (await gitText(process.cwd(), ["show", "-s", "--format=%P", oid])).split(" ").filter(Boolean);
      if (parent.length > 1)
        throw new Error(
          "Conversation merges are not supported yet; publish separate branches."
        );
      if (parent[0]) {
        const previous = await readSnapshot(process.cwd(), parent[0]), known = new Map(previous.records.map((r) => [r.data.id, r]));
        for (const record of snap.records) {
          const old2 = known.get(record.data.id);
          if (old2 && record.kind === "event" && fingerprint(old2.data) !== fingerprint(record.data))
            throw new Error("Existing events are immutable");
        }
      }
    }
  }
} catch (e) {
  console.error(
    "Orbit rejected push: " + (e instanceof Error ? e.message : String(e))
  );
  process.exitCode = 1;
}
