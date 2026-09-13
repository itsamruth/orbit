import type { Session, Workstream } from "../protocol/index.js";
import type { GitRepository } from "../storage/git/index.js";
import { recoverCapture } from "./runtime.js";

type Conversation = {
  session: Session;
  workstream: Workstream;
  updatedAt: string;
};

// Use captured activity, not the active pointer or the order of imported rows.
export async function latestConversation(
  repo: GitRepository,
  projectId: string,
  root: string,
): Promise<Conversation> {
  const sessions = await repo.list<Session>(projectId, "session");
  const workstreams = await repo.list<Workstream>(projectId, "workstream");
  const conversations: Conversation[] = [];
  for (const workstream of workstreams) {
    const { events } = await repo.handoffEvents(projectId, workstream.id);
    for (const session of sessions.filter(
      (item) => item.workstreamId === workstream.id,
    )) {
      const own = events.filter((event) => event.sessionId === session.id);
      if (
        !own.some(
          (event) =>
            event.payload.type === "assistant_message" ||
            (event.payload.type === "user_message" &&
              !event.payload.text.startsWith("[Orbit capture")),
        )
      )
        continue;
      const timestamp = Math.max(
        Date.parse(session.endedAt ?? session.startedAt),
        ...own.map((event) => Date.parse(event.occurredAt)),
      );
      conversations.push({
        session,
        workstream,
        updatedAt: new Date(timestamp).toISOString(),
      });
    }
  }
  conversations.sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) ||
      b.session.id.localeCompare(a.session.id),
  );
  let latest = conversations[0];

  // A user may have launched Claude or Codex directly, without the Orbit wrapper.
  const { listImportCandidates, importHistoricalSessions } =
    await import("../intelligence/memory.js");
  const candidates = await listImportCandidates(repo, projectId, root);
  const native = candidates[0];
  if (
    native &&
    (!latest || Date.parse(native.updatedAt) > Date.parse(latest.updatedAt))
  ) {
    if (native.importState === "conflict")
      throw new Error(
        "The latest native transcript has changed before its saved offset. Resolve the import conflict before switching.",
      );
    const existing = sessions.find(
      (session) =>
        session.agent === native.agent &&
        session.nativeSessionId === native.nativeSessionId,
    );
    let session: Session;
    if (existing?.captureMode === "live") {
      // Keep the existing identity and capture offset when a native chat was resumed.
      await recoverCapture(repo, projectId, existing);
      session = { ...existing, status: "ended", endedAt: native.updatedAt };
      await repo.put(projectId, "session", session);
      const workstream = workstreams.find(
        (item) => item.id === session.workstreamId,
      );
      if (workstream)
        await repo.put(projectId, "workstream", {
          ...workstream,
          updatedAt: native.updatedAt,
        });
      await repo.checkpoint("Save latest conversation before switching agents");
    } else {
      console.error(
        "Orbit: importing the latest " +
          native.agent +
          " conversation from this project.",
      );
      const imported = await importHistoricalSessions(repo, projectId, root, [
        native.id,
      ]);
      session = imported.sessions[0]!;
    }
    const workstream = await repo.get<Workstream>(
      projectId,
      "workstream",
      session.workstreamId,
    );
    if (!workstream)
      throw new Error("The latest conversation's workstream is missing.");
    latest = { session, workstream, updatedAt: native.updatedAt };
  }
  if (!latest)
    throw new Error(
      "No saved conversation found in this project. Start with orbit claude or orbit codex, then switch after your first conversation.",
    );
  return latest;
}
