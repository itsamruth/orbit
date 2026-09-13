import { NORMALIZER_VERSION, normalizeNative, type NativeState } from "./normalize.js";
import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EventPayload, UniversalEvent } from "../../domain/index.js";
export interface CaptureIdentity {
  projectId: string;
  workstreamId: string;
  sessionId: string;
}
export interface NativeSession {
  id: string;
  projectRoot: string;
  path: string;
}
export interface AgentCapabilities {
  version: string;
  capture: "jsonl";
  continuation: "user-prompt";
  maxContextBytes: number;
}
export interface AgentAdapter {
  readonly id: string;
  isTurnComplete?(record: unknown): boolean;
  probe(): Promise<AgentCapabilities>;
  discover(
    projectRoot: string,
    identity?: { nativeId?: string; marker?: string; since?: number },
  ): Promise<NativeSession[]>;
  normalize(record: unknown): EventPayload[];
  launchArgs(input: {
    nativeId: string;
    marker: string;
    context?: string;
    args: string[];
  }): string[];
}
export class AdapterNotImplementedError extends Error {
  constructor(agent: string) {
    super(agent + " integration does not support this native format.");
  }
}
export function eventId(
  sessionId: string,
  sourceOffset: number,
  index: number,
) {
  return (
    "evt_" +
    createHash("sha256")
      .update(sessionId + ":" + sourceOffset + ":" + index)
      .digest("hex")
      .slice(0, 40)
  );
}
export async function jsonlFiles(root: string, depth = 4): Promise<string[]> {
  if (depth < 0) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await jsonlFiles(path, depth - 1)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) paths.push(path);
  }
  return paths;
}
export async function prefix(path: string, limit = 128000): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
export async function readRecords(
  path: string, offset: number, maxBytes = 1024 * 1024,
): Promise<{ records: { value: unknown; offset: number }[]; position: number; malformed: number }> {
  const info = await stat(path);
  if (info.size < offset) throw new Error("Native transcript was truncated; refusing to replay under the same event IDs");
  const handle = await open(path, "r");
  try {
    const chunks: Buffer[] = [];
    let count = 0, lastNewline = -1;
    while (offset + count < info.size) {
      const buffer = Buffer.alloc(Math.min(65536, info.size - offset - count));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset + count);
      if (!bytesRead) break;
      const part = buffer.subarray(0, bytesRead);
      const nl = part.lastIndexOf(10);
      if (nl >= 0) lastNewline = count + nl;
      chunks.push(part); count += bytesRead;
      if (lastNewline >= 0 && count >= maxBytes) break;
      if (count > 64 * 1024 * 1024) throw new Error("Native JSONL record exceeds the 64 MiB capture limit; offset was not advanced.");
    }
    if (lastNewline < 0) return { records: [], position: offset, malformed: 0 };
    const bytes = Buffer.concat(chunks);
    const records: { value: unknown; offset: number }[] = [];
    let start = 0, malformed = 0;
    for (let i = 0; i <= lastNewline; i++) {
      if (bytes[i] !== 10) continue;
      const line = bytes.subarray(start, i).toString("utf8");
      if (line.trim()) {
        try { records.push({ value: JSON.parse(line), offset: offset + start }); }
        catch { malformed++; records.push({ value: { type: "orbit_parse_error" }, offset: offset + start }); }
      }
      start = i + 1;
    }
    return { records, position: offset + lastNewline + 1, malformed };
  } finally { await handle.close(); }
}

export function normalizeBatch(
  adapter: AgentAdapter, identity: CaptureIdentity,
  records: { value: unknown; offset: number }[], startSequence: number, occurredAt: string,
  state: NativeState = { version: NORMALIZER_VERSION, nativeVersion: "unknown", turnId: null, seen: [] },
  bootstrapHash?: string,
): UniversalEvent[] {
  if (state.version !== NORMALIZER_VERSION) throw new Error("Unsupported normalizer version");
  let sequence = startSequence;
  const seen = new Set(state.seen);
  const result: UniversalEvent[] = [];
  for (const record of records) {
    const r = record.value as any;
    if (r?.type === "session_meta") state.nativeVersion = String(r.payload?.cli_version ?? "unknown");
    if (typeof r?.version === "string") state.nativeVersion = r.version;
    const nativeId = r?.ordinal ?? r?.uuid ?? r?.payload?.id;
    const recordId = nativeId == null ? "offset:" + record.offset : String(r.type) + ":" + String(r.payload?.type ?? "") + ":" + String(nativeId) + ":" + String(r.apiBlockIndex ?? "");
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const nativeTurn = r?.payload?.turn_id ?? r?.turnId;
    if (typeof nativeTurn === "string") state.turnId = nativeTurn;
    const parts = normalizeNative(adapter.id, record.value, bootstrapHash);
    if (adapter.id === "claude" && parts.some((p) => p.payload.type === "user_message")) state.turnId = String(r.uuid ?? recordId);
    for (const part of parts) {
      const id = "evt_" + createHash("sha256").update(identity.sessionId + ":" + recordId + ":" + part.blockIndex + ":" + part.payload.type).digest("hex").slice(0, 40);
      const timestamp = r?.timestamp;
      result.push({
        schemaVersion: 2, id, ...identity, sequence: sequence++,
        occurredAt: typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)) ? timestamp : occurredAt,
        payload: part.payload,
        source: { adapter: adapter.id, normalizerVersion: NORMALIZER_VERSION, nativeVersion: state.nativeVersion, recordId, offset: record.offset, blockIndex: part.blockIndex },
        ...(part.messageId ? { messageId: part.messageId } : /message$/.test(part.payload.type) ? { messageId: recordId } : {}),
        ...(state.turnId ? { turnId: state.turnId } : {}),
        ...(part.phase ? { phase: part.phase } : {}),
      });
    }
  }
  state.seen = [...seen];
  return result;
}
