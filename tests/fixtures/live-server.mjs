import {
  SqliteDatabase,
  Repository,
} from "../../packages/local-store/dist/index.js";
import { buildServer } from "../../apps/api/dist/server.js";
import { GitRepository } from "../../packages/git-store/dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "orbit-browser-"));
const repo = await GitRepository.open(root, true);
const now = new Date().toISOString();
await repo.put("prj_live", "project", {
  id: "prj_live",
  name: "live-integration",
  description: "Real Git browser integration",
  owner: "local",
  repository: null,
  createdAt: now,
  updatedAt: now,
  cloudSyncEnabled: false,
  excludedPaths: [],
});
await repo.put(
  "prj_live",
  "workstream",
  {
    id: "work_live",
    projectId: "prj_live",
    title: "Verify connected history",
    branch: "main",
    createdAt: now,
    updatedAt: now,
  },
  false,
);
await repo.put(
  "prj_live",
  "session",
  {
    id: "sess_live",
    projectId: "prj_live",
    workstreamId: "work_live",
    agent: "codex",
    nativeSessionId: "fixture-live",
    status: "ended",
    startedAt: now,
    endedAt: now,
  },
  false,
);
await repo.put(
  "prj_live",
  "event",
  {
    schemaVersion: 1,
    id: "evt_live",
    projectId: "prj_live",
    workstreamId: "work_live",
    sessionId: "sess_live",
    sequence: 0,
    occurredAt: now,
    payload: {
      type: "user_message",
      text: "This conversation was loaded from the real Orbit API.",
    },
  },
  false,
);
await repo.checkpoint("First captured conversation");
await repo.createBranch("experiment");
await repo.put("prj_live", "event", {
  schemaVersion: 1,
  id: "evt_second",
  projectId: "prj_live",
  workstreamId: "work_live",
  sessionId: "sess_live",
  sequence: 1,
  occurredAt: now,
  payload: {
    type: "assistant_message",
    text: "Git checkpoints preserve the next turn.",
  },
});
await repo.checkpoint("Second captured turn");
await repo.db.close();
const db = new SqliteDatabase(":memory:");
const app = await buildServer(db, {
  origin: "http://127.0.0.1:5174",
  devAuth: true,
  localRoot: root,
  repositoryRoot: join(root, "server"),
});
await app.listen({ host: "127.0.0.1", port: 4319 });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await db.close();
    await rm(root, { recursive: true, force: true });
  });
