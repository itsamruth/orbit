import type { GitRepository } from "@orbit/git-store";
import type {
  SearchResult,
  Session,
  SessionSummary,
  UniversalEvent,
  Workstream,
} from "@orbit/contracts";

export interface SearchOptions {
  query: string;
  agent?: string | undefined;
  branch?: string | undefined;
  type?: "event" | "summary" | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: number;
  limit?: number;
}

function eventText(event: UniversalEvent) {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.command === "string") return payload.command;
  if (typeof payload.path === "string") return payload.path;
  return JSON.stringify(payload);
}

export async function ensureSearchIndex(
  repo: GitRepository,
  projectId: string,
  revision: string,
) {
  await repo.db.query(
    "CREATE VIRTUAL TABLE IF NOT EXISTS orbit_fts USING fts5(id UNINDEXED,type UNINDEXED,session_id UNINDEXED,workstream_id UNINDEXED,agent UNINDEXED,branch UNINDEXED,occurred_at UNINDEXED,title,body,tokenize='unicode61 remove_diacritics 2')",
  );
  if ((await repo.state("search:indexed:" + projectId)) === revision) return;
  const sessions = await repo.list<Session>(projectId, "session");
  const workstreams = await repo.list<Workstream>(projectId, "workstream");
  const bySession = new Map(sessions.map((session) => [session.id, session]));
  const byWorkstream = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
  await repo.db.transaction(async (db) => {
    await db.query("DELETE FROM orbit_fts");
    for (const event of await repo.list<UniversalEvent>(projectId, "event")) {
      const session = bySession.get(event.sessionId);
      if (!session) continue;
      const payload = event.payload as Record<string, unknown>;
      await db.query(
        "INSERT INTO orbit_fts (id,type,session_id,workstream_id,agent,branch,occurred_at,title,body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          event.id,
          "event",
          event.sessionId,
          event.workstreamId,
          session.agent,
          byWorkstream.get(event.workstreamId)?.branch ?? "",
          event.occurredAt,
          String(payload.type).replaceAll("_", " "),
          eventText(event),
        ],
      );
    }
    for (const summary of await repo.list<SessionSummary>(projectId, "summary")) {
      const session = bySession.get(summary.sessionId);
      if (!session) continue;
      await db.query(
        "INSERT INTO orbit_fts (id,type,session_id,workstream_id,agent,branch,occurred_at,title,body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          summary.id,
          "summary",
          summary.sessionId,
          summary.workstreamId,
          session.agent,
          byWorkstream.get(summary.workstreamId)?.branch ?? "",
          summary.generatedAt,
          summary.title,
          [
            summary.overview,
            ...summary.objectives,
            ...summary.decisions.map((item) => item.text),
            ...summary.rejectedApproaches.map((item) => item.text),
            ...summary.openQuestions.map((item) => item.text),
            ...summary.tasks.map((item) => item.text),
            ...summary.files,
          ].join("\n"),
        ],
      );
    }
    await repo.setState("search:indexed:" + projectId, revision, db);
  });
}

function excerpt(body: string, query: string) {
  const index = body.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 90);
  return body.slice(start, start + 280).replace(/\s+/g, " ").trim();
}

export async function searchIndex(
  repo: GitRepository,
  projectId: string,
  revision: string,
  options: SearchOptions,
): Promise<{ items: SearchResult[]; nextCursor: string | null }> {
  const query = options.query.trim();
  if (!query || query.length > 200) throw new Error("Enter a search query up to 200 characters");
  await ensureSearchIndex(repo, projectId, revision);
  const cursor = Math.max(0, options.cursor ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const phrase = '"' + query.replaceAll('"', '""') + '"';
  const values: unknown[] = [phrase];
  let sql = "SELECT id,type,session_id,workstream_id,agent,occurred_at,title,body,bm25(orbit_fts) AS rank FROM orbit_fts WHERE orbit_fts MATCH $1";
  const filter = (column: string, value: string | undefined, operator = "=") => {
    if (!value) return;
    values.push(value);
    sql += " AND " + column + operator + "$" + values.length;
  };
  filter("agent", options.agent);
  filter("branch", options.branch);
  filter("type", options.type);
  filter("occurred_at", options.from, ">=");
  filter("occurred_at", options.to, "<=");
  values.push(limit + 1, cursor);
  sql += " ORDER BY rank,occurred_at DESC LIMIT $" + (values.length - 1) + " OFFSET $" + values.length;
  const rows = await repo.db.query<{
    id: string;
    type: "event" | "summary";
    session_id: string;
    workstream_id: string;
    agent: string;
    occurred_at: string;
    title: string;
    body: string;
    rank: number;
  }>(sql, values);
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      type: row.type,
      sessionId: row.session_id,
      workstreamId: row.workstream_id,
      agent: row.agent,
      title: row.title,
      snippet: excerpt(row.body, query),
      occurredAt: row.occurred_at,
      score: -Number(row.rank),
    })),
    nextCursor: rows.length > limit ? String(cursor + limit) : null,
  };
}
