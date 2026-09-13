# Orbit

**Git for AI agent conversations.**

Orbit gives coding-agent conversations durable history. It captures each session,
normalizes it into an agent-independent format, and lets you continue the same
workstream with another agent without starting over.

Claude Code and Codex are the first supported adapters. The conversation belongs
to Orbit, not to either agent.

```sh
orbit init
orbit claude

# When Claude reaches a limit or you want a different agent:
orbit switch codex
```

Orbit finds the latest substantive conversation, prepares a bounded handoff from
its normalized history, and launches the destination agent with the relevant
messages, tool outcomes, workspace observations, and turn state.

## Why Orbit

Agent sessions are usually isolated inside vendor-specific transcript formats.
Moving from one coding agent to another means losing context, manually explaining
the work again, or pasting an unreliable summary.

Orbit treats conversation history as a project artifact:

- **Durable:** history survives individual agent processes and provider limits.
- **Portable:** adapters translate native transcripts into one unified model.
- **Traceable:** projects, workstreams, sessions, events, and handoffs retain identity.
- **Local-first:** the authoritative history lives in `.orbit/` inside your project.
- **Selective:** dashboard publishing is opt-in and separate from local capture.

## Mental model

```text
Project
  └── Workstream            one continuing conversation
        ├── Claude session
        ├── Codex session
        └── Ordered events  messages, tools, turns, and workspace observations
```

Switching agents creates a linked session in the same workstream. It does not copy
the conversation into a second source of truth.

## Install from source

Orbit currently requires Node.js 22.14 or newer and Git. Install and authenticate
Claude Code or Codex separately.

```sh
git clone https://github.com/itsamruth/orbit.git
cd orbit
npm ci
npm run build
npm link
orbit --version
```

The package is prepared as `@orbit/cli` but is not yet published to npm.

## Quick start

Initialize Orbit from an existing project:

```sh
cd your-project
orbit init
```

Launch an agent through Orbit so its conversation is captured:

```sh
orbit claude
# or
orbit codex
```

Exit the current agent normally, then continue the latest conversation:

```sh
orbit switch codex
# or
orbit switch claude
```

Orbit shows which conversation and source session it selected before launching the
destination agent.

## Commands

| Command | Purpose |
| --- | --- |
| `orbit init` | Initialize Orbit in the current project |
| `orbit claude` | Launch Claude Code and capture the session |
| `orbit codex` | Launch Codex and capture the session |
| `orbit switch <agent>` | Continue the latest substantive conversation in another agent |
| `orbit continue <workstream> --agent <agent>` | Continue a specific workstream |
| `orbit history` | List conversations with the most recently edited first |
| `orbit context <workstream>` | Read normalized history with cursor-based pagination |
| `orbit import --list` | Discover supported native conversations for import |
| `orbit log` | Browse saved conversation checkpoints |
| `orbit auth login` | Connect the CLI to an Orbit dashboard |
| `orbit publish select <session>` | Select a session for dashboard publishing |
| `orbit push` | Publish the selected local projection |
| `orbit help` | Show CLI help |

## How switching works

1. Orbit drains the source transcript and records its latest capture position.
2. Native records are normalized into versioned conversation events.
3. Orbit selects the latest substantive workstream unless one is specified.
4. A deterministic context bundle is built within the destination's byte budget.
5. The destination adapter renders that bundle and launches the agent.
6. The new session is linked back to the same workstream.

Previous tool activity is passed as evidence, never as an instruction to replay.
Completed, interrupted, failed, and uncertain turns remain distinguishable. Older
history stays available through `orbit context` when it does not fit in the initial
handoff.

Orbit carries conversation context forward; it does not currently recreate earlier
turns as native Claude Code or Codex scrollback.

## Storage and privacy

The local `.orbit/` directory contains conversation metadata, normalized events,
capture state, and Git-backed checkpoints. Orbit applies configured redaction and
excluded-path rules before normalized content is stored or published.

Orbit does not transfer source files, agent credentials, private model reasoning,
or complete raw vendor transcripts by default. Attachment references are preserved,
but binary attachment synchronization is outside the current release.

Deleting a session removes it from the current history revision. Older Git commits
and native agent transcripts may still retain the original data.

## Dashboard boundary

This repository contains the Orbit CLI only. It does not include a web server,
browser UI, or hosted account database. The dashboard is maintained and deployed
from a separate repository.

Publishing is disabled by default and limited to explicitly selected sessions:

```sh
export ORBIT_SERVER_URL=https://your-orbit-server.example
orbit auth login
orbit publish select <session-id>
orbit publish enable
orbit push
```

## Development

```sh
npm ci
npm run typecheck
npm test
npm run format:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions,
[docs/architecture.md](docs/architecture.md) for module boundaries, and
[docs/protocol.md](docs/protocol.md) for the conversation and publishing protocol.
