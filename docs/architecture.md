# Architecture

Orbit is one npm package with internal TypeScript modules. Internal directories are not independently published packages.

```text
bin/orbit.js             Executable entry and version output
src/
  cli.ts                Project initialization and command dispatch
  commands/             History, publishing, memory, and session commands
  adapters/             Codex and Claude discovery and event normalization
  auth/                 Device sign-in and local client credentials
  domain/               Conversation, session, and event types
  intelligence/         Native import, summaries, and local search
  project/              Project identity and source-checkout inspection
  protocol/             Versioned wire contracts shared with the dashboard
  publishing/           Selected-history projection and Git publishing worker
  security/             Capture exclusions and secret redaction
  sessions/             Capture lifecycle, recovery, switching, and handoff
  storage/              Git snapshots, SQLite journal, and legacy migration
tests/                  Unit and integration tests with fake agents
scripts/                Build and release checks
docs/                   Architecture, protocol, and adapter guidance
```

The command layer coordinates local services. Adapters normalize native transcripts into domain events. Security filtering runs before storage. The SQLite journal atomically records events and capture offsets; Git checkpoints persist durable conversation history. Sessions build bounded handoffs from those saved events and launch the chosen native agent.

Publishing creates a projection containing selected sessions. The worker authenticates through the dashboard's device API and sends commits over Git. Network failure leaves local history available for a later retry.

The dashboard owns HTTP serving, browser authentication, PostgreSQL, hosted bare repositories, and the web UI. The CLI contains none of those implementations. Local import and summary code was extracted from the old API package so it does not require an HTTP server.

The previous layout remains in the repository's initial commit. Generated bundles and browser assets are no longer tracked. The original development workspace remains separate from this repository.
