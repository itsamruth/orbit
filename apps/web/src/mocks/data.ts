import type {
  Account,
  Checkpoint,
  Project,
  Workstream,
  Session,
  UniversalEvent,
  Device,
} from "@orbit/contracts";
const at = (hours: number) =>
  new Date(Date.now() - hours * 3600000).toISOString();
export const me: Account = { id: "usr_demo", login: "amruth", avatarUrl: null };
export const projects: Project[] = [
  {
    id: "prj_orbit",
    name: "orbit",
    description:
      "Git for AI agent sessions. Capture the conversation, keep the context, and continue with any agent.",
    repository: "github.com/amruth/orbit",
    owner: "amruth",
    createdAt: at(240),
    updatedAt: at(0.1),
    cloudSyncEnabled: true,
    excludedPaths: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key"],
  },
  {
    id: "prj_relay",
    name: "relay",
    description:
      "A lightweight API gateway. Building better connections, one conversation at a time.",
    repository: null,
    owner: "amruth",
    createdAt: at(100),
    updatedAt: at(28),
    cloudSyncEnabled: false,
    excludedPaths: [],
  },
];
const titles = [
  "Build the project session viewer",
  "Implement incremental cloud sync",
  "Add project initialization and discovery",
  "Design the universal event model",
  "Handle interrupted agent sessions",
];
export const workstreams: Workstream[] = titles.map((title, i) => ({
  id: "work_" + i,
  projectId: "prj_orbit",
  title,
  branch: [
    "feat/session-viewer",
    "feat/cloud-sync",
    "main",
    "main",
    "fix/session-recovery",
  ][i]!,
  createdAt: at(70 + i * 20),
  updatedAt: at([0.1, 2, 20, 48, 65][i]!),
}));
export const sessions: Session[] = workstreams.flatMap((w, i) =>
  [0, 1].map((j) => ({
    id: "sess_" + i + "_" + j,
    projectId: w.projectId,
    workstreamId: w.id,
    agent: j ? "claude" : "codex",
    nativeSessionId: "native_demo_" + i + "_" + j,
    status:
      i === 0 && j === 1
        ? "active"
        : i === 4 && j === 1
          ? "interrupted"
          : "ended",
    startedAt: at(5 + i * 14 - j),
    endedAt: i === 0 && j === 1 ? null : at(4 + i * 14 - j),
  })),
);
export const events: UniversalEvent[] = sessions.flatMap((s) =>
  [
    {
      type: "user_message",
      text: "Build the project session viewer. I want a clear timeline of conversations, tool calls, and agent handoffs.",
    },
    {
      type: "assistant_message",
      text: "I’ll connect the viewer to the project history and make tool output expandable.\n\nThe session belongs to the project, so switching agents will preserve the task context.",
    },
    {
      type: "tool_call",
      callId: "call_1",
      name: "read_file",
      input: { path: "apps/web/src/SessionViewer.tsx" },
    },
    {
      type: "tool_result",
      callId: "call_1",
      output:
        "export function SessionViewer() {\n  return <main>Session history</main>;\n}",
      failed: false,
    },
    {
      type: "assistant_message",
      text: "The viewer now renders normalized events in session order.\n\n- Messages support Markdown and code blocks.\n- Tool calls and results can be expanded.\n- Pagination keeps long conversations manageable.\n\n```tsx\n<SessionTimeline events={events} />\n```",
    },
    {
      type: "user_message",
      text: "Keep the source branch visible when continuing with Claude. We should warn about any workspace mismatch.",
    },
    {
      type: "git_state",
      workspace: {
        root: "[local workspace]",
        branch: "feat/session-viewer",
        head: "a4d782a933cb012b38c9f9d09ccdfa3492ed31a0",
        porcelain: "",
        dirty: false,
      },
    },
  ].map(
    (payload, i) =>
      ({
        schemaVersion: 1,
        id: s.id + "_evt_" + i,
        projectId: s.projectId,
        workstreamId: s.workstreamId,
        sessionId: s.id,
        sequence: i,
        occurredAt: new Date(Date.parse(s.startedAt) + i * 60000).toISOString(),
        payload,
      }) as UniversalEvent,
  ),
);
export const checkpoints: Checkpoint[] = [
  "Completed conversation turn",
  "Partial conversation checkpoint",
  "New workstream: Build the project session viewer",
  "Initialize Orbit conversation history",
].map((message, i) => ({
  oid: (i + 1).toString(16).padStart(2, "0").repeat(20),
  parents: i === 3 ? [] : [(i + 2).toString(16).padStart(2, "0").repeat(20)],
  createdAt: at(i * 6 + 0.2),
  author: "Orbit",
  message,
}));

export const devices: Device[] = [
  {
    id: "dev_demo",
    name: "Development laptop",
    createdAt: at(100),
    lastSeenAt: at(0.1),
  },
];
