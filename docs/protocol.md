# Conversation format and dashboard compatibility

Orbit owns the conversation. Native transcripts are capture inputs; agent prompts and dashboard exports are projections, not the canonical archive.

## Version 2

New captures use UniversalEvent schema version 2. The existing project/workstream/session/event hierarchy is unchanged. Workstreams retain conversations across linked agent sessions. Events retain session-scoped sequence ordering, source adapter and normalizer version, native record identity/byte offset, content-block index, message grouping, assistant phase, and turn identity where known.

Messages retain user/assistant roles. Tool calls and results are distinct events paired by session ID plus native call ID. Results record completed, failed, interrupted, or unknown outcomes. A returned string is not evidence of success. Turn-state events, not process exit codes, establish completed turns. Runtime context is separate from human conversation. Compaction and unsupported content produce explicit summaries or coverage notices. Private reasoning and vendor instructions are not portable conversation records.

Large payloads are privacy-filtered in full, then serialized into ordered content_chunk events. Each chunk carries groupId, index, and total; concatenating their text reconstructs the original payload JSON. This representation keeps each journal entity below 256 KB and preserves exact text without copying raw vendor transcripts. Attachment records preserve media type, reference, and availability, not binary content. Native JSONL records above 64 MiB fail without advancing the capture offset.

Capture, import, and recovery share one normalizer and atomically persist its version, source deduplication state, privacy-filter state, events, and byte offset. Deduplication uses native record identity, never user text. The recorded bootstrap digest identifies live handoff prompts; known legacy Orbit bootstrap syntax remains readable.

## Existing history

Version-1 events, IDs, and checkpoints remain unchanged. A compatibility view filters recognized generated environment blocks and reports unavailable provenance/turn boundaries. Previously false failure flags remain unknown outcomes, not confirmed success. Unsupported normalizer state is an explicit error. Existing manually named workstreams retain their titles.

## Context preparation

The context bundle is a deterministic, bounded view of the unified conversation. Readable role-labelled exchanges replace raw event-array JSON prompts. Complete tool groups are selected together and rendered in their original order. Oversized messages have explicit excerpts; all captured content remains in local history. Existing summaries are reused only when their source hash still matches. Switching does not launch a summarization model, including during Orbit-controlled shutdown.

Private .orbit/handoffs/<handoff-id>/manifest.json and context.md files record the bundle, selected and omitted events, and coverage. A completed turn requests acknowledgment and waiting; interrupted/failed turns identify unfinished work, while unknown state is explicitly uncertain. The destination retains its own identity, tools, approvals, and safety rules. Historical tools are not replayed.

`orbit context <workstream> --json [--cursor <event-id>] [--limit <1-100>]` opens the local journal read-only. It returns chronological records (including large-content chunks), nextCursor, and coverage. The default page size is 25. Pass nextCursor as --cursor; unknown or cross-conversation cursors are rejected. The command makes no model calls, starts no agents, and publishes nothing.

## Dashboard projection

The CLI and dashboard remain independent repositories. /api/v1 and Git smart HTTP are unchanged. Selected-session publishing projects canonical version-2 events to version 1 and strips CLI-only session/workstream metadata. Tool pairing is retained; status, attachment limitations, compaction and coverage are represented as text. Oversized dashboard content is explicitly excerpted. Projection does not rewrite the local canonical record.

Generic conversation Git remotes require version-2-capable clients for richer records. Dashboard-compatible publishing uses the selected-session version-1 projection. Native Claude/Codex scrollback import, binary attachment synchronization, and dashboard UI/schema changes are outside this release. Context continuity through supported initial prompts is not a claim of native transcript import.
