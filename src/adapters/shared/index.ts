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
  path: string,
  offset: number,
  maxBytes = 1024 * 1024,
): Promise<{
  records: { value: unknown; offset: number }[];
  position: number;
  malformed: number;
}> {
  const info = await stat(path);
  if (info.size < offset)
    throw new Error(
      "Native transcript was truncated; refusing to replay under the same event IDs",
    );
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(
      Math.min(maxBytes, Math.max(0, info.size - offset)),
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const bytes = buffer.subarray(0, bytesRead);
    const end = bytes.lastIndexOf(10);
    if (end < 0) {
      if (bytesRead === maxBytes) {
        let position = offset + bytesRead;
        const scan = Buffer.alloc(64 * 1024);
        while (position < info.size) {
          const { bytesRead: scanned } = await handle.read(
            scan,
            0,
            Math.min(scan.length, info.size - position),
            position,
          );
          if (!scanned) break;
          const newline = scan.subarray(0, scanned).indexOf(10);
          if (newline >= 0)
            return {
              records: [],
              position: position + newline + 1,
              malformed: 1,
            };
          position += scanned;
        }
        return { records: [], position: info.size, malformed: 1 };
      }
      return { records: [], position: offset, malformed: 0 };
    }
    const records: { value: unknown; offset: number }[] = [];
    let start = 0,
      malformed = 0;
    for (let i = 0; i <= end; i++) {
      if (bytes[i] !== 10) continue;
      const line = bytes.subarray(start, i).toString("utf8");
      if (line.trim()) {
        try {
          records.push({ value: JSON.parse(line), offset: offset + start });
        } catch {
          malformed++;
        }
      }
      start = i + 1;
    }
    return { records, position: offset + end + 1, malformed };
  } finally {
    await handle.close();
  }
}
export function normalizeBatch(
  adapter: AgentAdapter,
  identity: CaptureIdentity,
  records: { value: unknown; offset: number }[],
  startSequence: number,
  occurredAt: string,
): UniversalEvent[] {
  let sequence = startSequence;
  return records.flatMap((record) =>
    adapter.normalize(record.value).map((payload, index) => {
      const native = record.value as { timestamp?: unknown };
      return {
        schemaVersion: 1 as const,
        id: eventId(identity.sessionId, record.offset, index),
        ...identity,
        sequence: sequence++,
        occurredAt:
          typeof native?.timestamp === "string" &&
          Number.isFinite(Date.parse(native.timestamp))
            ? native.timestamp
            : occurredAt,
        payload,
      };
    }),
  );
}
