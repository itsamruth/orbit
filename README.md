# Orbit

**Git for AI agent conversations.**

Orbit gives coding-agent conversations durable history. It captures each session,
normalizes it into an agent-independent format, and lets you continue the same
workstream with another agent without starting over.

Claude Code and Codex are the first supported adapters. The conversation belongs
to Orbit, not to either agent.

## Install

Orbit requires Node.js 22.14 or newer and Git. Install Claude Code or Codex
separately, then install Orbit globally from npm:

```sh
npm install -g @itsamruth/orbit
orbit --version
```

## Quick start

```sh
cd your-project
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
- **Visible:** a local dashboard shows captured history automatically, without an account.
- **Selective:** publishing to a hosted server remains opt-in.

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

```sh
git clone https://github.com/itsamruth/orbit.git
cd orbit
npm ci
npm run build
npm link
orbit --version
```

## Commands

| Command                                       | Purpose                                                       |
| --------------------------------------------- | ------------------------------------------------------------- |
| `orbit init`                                  | Initialize Orbit in the current project                       |
| `orbit claude`                                | Launch Claude Code and capture the session                    |
| `orbit codex`                                 | Launch Codex and capture the session                          |
| `orbit switch <agent>`                        | Continue the latest substantive conversation in another agent |
| `orbit continue <workstream> --agent <agent>` | Continue a specific workstream                                |
| `orbit history`                               | List conversations with the most recently edited first        |
| `orbit context <workstream>`                  | Read normalized history with cursor-based pagination          |
| `orbit import --list`                         | Discover supported native conversations for import            |
| `orbit log`                                   | Browse saved conversation checkpoints                         |
| `orbit dashboard`                             | Open the local dashboard with automatic history updates       |
| `orbit dashboard --stop`                      | Stop the background dashboard service                         |
| `orbit auth login`                            | Connect the CLI to an Orbit dashboard                         |
| `orbit publish select <session>`              | Select a session for dashboard publishing                     |
| `orbit push`                                  | Publish the selected local projection                         |
| `orbit help`                                  | Show CLI help                                                 |

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

## Local dashboard

Initialize a project, capture or import conversations, and open the viewer:

```sh
orbit init
orbit dashboard
```

The dashboard runs at `http://127.0.0.1:4319` and opens directly to your projects.
It includes project history, workstreams, connected agent sessions, conversation
search, checkpoints, and comparisons. No account, sign-in, Docker, or manual push
is needed. New captured events appear automatically, even before a checkpoint.

`orbit init` and capture/import commands register the project and start the local
service. For projects created with an older Orbit release, run `orbit dashboard`
inside each project once. The dashboard then lists those registered projects from
any directory. Existing native agent transcripts still require `orbit import`.

The viewer reads each project's existing `.orbit/` database. A private directory
at `~/.orbit/viewer/projects/` records project locations; it does not duplicate the
conversations. The service binds to loopback and accepts same-origin requests.
The browser is read only; use the CLI to change history or launch an agent.

```sh
orbit dashboard --no-open        # Print the URL without opening a browser
orbit dashboard --stop           # Stop the background service
orbit dashboard --foreground     # Run the service in this terminal
orbit dashboard --port 4320      # Use another local port
```

Set `ORBIT_VIEWER=0` to disable automatic viewer startup and project registration.
An explicit `orbit dashboard` still works. Set `ORBIT_VIEWER_PORT` to keep a custom
port across commands. Closing a browser tab does not stop the service.

The npm package includes the local UI and its fonts. Hosted accounts and the
hosted API remain in the separate `orbit-dashboard` repository.

## Optional hosted publishing

Use `orbit dashboard --remote` to print the configured hosted dashboard URL.
Hosted publishing is disabled by default and limited to selected sessions:

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
