# Dashboard compatibility

The CLI and dashboard have separate source repositories and release cycles. They communicate through `/api/v1` and Git smart HTTP, not workspace imports or filesystem links.

Conversation events, handoffs, and summaries currently use schema version 1. `src/domain/` defines those records; `src/protocol/` defines transport contracts. The dashboard maintains its corresponding schema definitions. Matching versions are currently coordinated manually, not enforced by a shared package.

Device authorization starts with `POST /api/v1/auth/device/start`. The user approves the displayed code in the dashboard, and the CLI polls `/api/v1/auth/device/token`. The resulting credential stays in the local Orbit configuration directory and is scoped to the configured server.

Project registration uses `POST /api/v1/projects`. Hosted conversation remotes use `/git/<project-id>.git`. Tokens are supplied through a Git askpass helper rather than embedded in remote URLs.

Git snapshots validate project identity, parent relationships, event sequences, content hashes, and schema versions. Source repositories and conversation repositories remain separate.

Before changing a persisted record or endpoint, document compatibility with older CLIs and dashboards. Prefer additive optional fields. Breaking changes require an explicit version or migration and compatibility tests against the dashboard. Do not silently reinterpret existing history.
