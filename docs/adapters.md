# Adapter compatibility

Orbit launches interactive Codex and Claude CLIs with normal native approval rules and a user-level initial prompt. It does not disable native sandboxing or approval controls.

- Codex: response_item JSONL records with message, function_call/output, and custom_tool_call/output payloads. The leading session_meta must match the project directory; a unique launch marker identifies Orbit's exact session. Duplicate event_msg message mirrors are ignored.
- Claude: native user/assistant JSONL records with text, tool_use, and tool_result content. Orbit supplies --session-id and reads the corresponding project transcript.
- Capability probing verifies native command availability and required CLI flags before launch. The transcript format is additionally checked during discovery and normalization; absence is reported within 30 seconds.
- Each Orbit launch creates a new native session. --continue means continuation through the universal handoff, not rewriting vendor-native sessions.

The installed Codex executable inspected during implementation reported 0.154.0 and supported initial prompts. Claude was not installed in the implementation environment. Native transcript shapes and switching are covered by sanitized, deterministic protocol fixtures. Real agent/version compatibility is not certified by fixture tests alone. New paginated/binary transcript formats require an adapter update; Orbit currently supports JSONL.

References: [Codex CLI](https://developers.openai.com/codex/cli/reference), [Claude CLI and session IDs](https://code.claude.com/docs/en/cli-reference).

Before a production release, run a real coding task in both directions with the intended native CLI versions and record capture completeness, context transfer, failure behavior, and manual context re-entry.
