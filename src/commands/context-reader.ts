import { join } from "node:path";
import { Repository, SqliteDatabase } from "../storage/journal/index.js";
import { readConversation, legacyView } from "../sessions/conversation.js";
import { renderEvent } from "../sessions/handoff/index.js";
export async function contextCommand(root: string, projectId: string, args: string[]): Promise<void> {
  const workstream = args[0];
  if (!workstream || !/^[a-zA-Z0-9_-]+$/.test(workstream)) throw new Error("Usage: orbit context <workstream> [--json] [--cursor <event-id>] [--limit <1-100>]");
  let cursor: string | null = null, limit = 25, json = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--cursor" && args[i + 1]) cursor = args[++i]!;
    else if (args[i] === "--limit" && args[i + 1]) limit = Number(args[++i]);
    else throw new Error("Unknown or incomplete context option");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Context limit must be between 1 and 100");
  const db = new SqliteDatabase(join(root, ".orbit", "state", "journal.sqlite"), true);
  try {
    const conversation = await readConversation(new Repository(db), projectId, workstream);
    const records = conversation.records.map(legacyView).filter((e) => e.payload.type !== "runtime_context");
    const index = cursor === null ? -1 : records.findIndex((e) => e.id === cursor);
    if (cursor !== null && index < 0) throw new Error("Context cursor is not in this conversation; restart pagination.");
    const items = records.slice(index + 1, index + 1 + limit);
    const nextCursor = index + 1 + items.length < records.length ? items.at(-1)!.id : null;
    const page = { schemaVersion: 2, workstreamId: workstream, items, nextCursor, coverage: conversation.coverage };
    console.log(json ? JSON.stringify(page) : items.map((e) => renderEvent(e, conversation.sessions.find((s) => s.id === e.sessionId)?.agent)).join("\n\n") + (nextCursor ? "\n\nNext: orbit context " + workstream + " --cursor " + nextCursor : "\n\nEnd of conversation."));
  } finally { await db.close(); }
}
