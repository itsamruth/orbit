import { minimatch } from "minimatch";
import type { UniversalEvent } from "../domain/index.js";
export interface CapturePolicy {
  excludedPaths: string[];
  excludedEventTypes: UniversalEvent["payload"]["type"][];
  cloudSyncEnabled: boolean;
}
export type FilterResult =
  | { action: "keep"; event: UniversalEvent }
  | { action: "drop"; reason: string };
export interface EventFilter {
  apply(event: UniversalEvent, policy: CapturePolicy): FilterResult;
}
export const defaultPolicy: CapturePolicy = {
  excludedPaths: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key"],
  excludedEventTypes: [],
  cloudSyncEnabled: false,
};
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*(?:PRIVATE KEY)[^-]*-----[\s\S]*?-----END [^-]*PRIVATE KEY[^-]*-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9_]{15,}|github_pat_[a-zA-Z0-9_]{15,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',;\\}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@");
}
export class PolicyFilter implements EventFilter {
  private excludedCalls = new Set<string>();
  snapshot() {
    return [...this.excludedCalls];
  }
  restore(ids: string[]) {
    this.excludedCalls = new Set(ids);
  }
  apply(event: UniversalEvent, policy: CapturePolicy): FilterResult {
    if (policy.excludedEventTypes.includes(event.payload.type))
      return { action: "drop", reason: "Excluded event type" };
    const serialized = JSON.stringify(event.payload);
    const tokens = serialized
      .split(/[\s"'\x00,{}:\[\]]+/)
      .map((t) => t.replaceAll("\\\\", "/"));
    const excluded = tokens.some((t) =>
      policy.excludedPaths.some((pattern) =>
        minimatch(t, pattern, { dot: true, matchBase: true }),
      ),
    );
    const p = event.payload;
    const key = "callId" in p ? event.sessionId + ":" + p.callId : null;
    if (excluded) {
      if (key) this.excludedCalls.add(key);
      return { action: "drop", reason: "Excluded file content" };
    }
    if (key && this.excludedCalls.has(key))
      return { action: "drop", reason: "Result from excluded tool call" };
    const walk = (value: unknown, key = ""): unknown => {
      if (
        /^(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)$/i.test(
          key,
        )
      )
        return "[REDACTED]";
      if (typeof value === "string") return redact(value);
      if (Array.isArray(value)) return value.map((v) => walk(v));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, walk(v, k)]),
        );
      return value;
    };
    return {
      action: "keep",
      event: { ...event, payload: walk(p) as UniversalEvent["payload"] },
    };
  }
}
