# Contributing

Use Node.js 22.14 or newer and Git. Run `npm ci`, then `npm test`.

Keep command parsing and terminal output in `src/commands/`. Put agent-specific discovery and normalization in `src/adapters/`. Session capture and handoff code must not import hosted server implementations. The dashboard is an external service accessed through its HTTP API and Git transport.

Add regression coverage for behavior changes. Unit tests exercise normalization, redaction, context limits, and project resolution. Integration tests use temporary repositories and fake agents; they must not require personal accounts or paid model calls. Server-side authentication and UI tests belong in the dashboard repository.

Run `npm run typecheck`, `npm test`, and `npm run format:check` before submitting a change. `npm test` builds the executable before testing it. Focused test scripts expect a completed build.

Generated output in `dist/` is ignored by Git and rebuilt for packaging. Never commit credentials, captured conversations, local databases, or release tarballs.

Schema changes must preserve existing conversation history or provide an explicit migration. Coordinate changes to `src/domain/` and `src/protocol/` with the dashboard; see `docs/protocol.md`.
