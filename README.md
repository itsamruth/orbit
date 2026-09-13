# Orbit

Keep coding conversations in Git and continue them in another agent.

```sh
orbit init
orbit claude
# Exit Claude when you want to switch.
orbit switch codex
```

Orbit selects the latest saved conversation in the current project, shows its title and source session, and launches the destination agent with context. It can also import a supported native transcript when the previous agent was launched directly.

## Install from source

Requires Node.js 22.14 or newer and Git. Install and authenticate Codex or Claude Code separately.

```sh
npm ci
npm run build
npm link
orbit --version
```

The package is prepared as `@orbit/cli`, but has not been published to npm. The package name and distribution license must be confirmed before release.

## Commands

| Command                                      | Purpose                                      |
| -------------------------------------------- | -------------------------------------------- |
| `orbit init`                                 | Initialize history in the current project    |
| `orbit claude` / `orbit codex`               | Launch an agent and capture its conversation |
| `orbit switch codex` / `orbit switch claude` | Continue the latest project conversation     |
| `orbit history`                              | List conversations, latest first             |
| `orbit import --list`                        | Discover existing native conversations       |
| `orbit continue <id> --agent <agent>`        | Continue a specific workstream               |
| `orbit log`                                  | Browse saved checkpoints                     |
| `orbit auth login`                           | Connect this machine to an Orbit dashboard   |
| `orbit dashboard`                            | Print the configured dashboard URL           |
| `orbit help`                                 | Show all commands                            |

## Publish selected conversations

```sh
export ORBIT_SERVER_URL=https://your-orbit-server.example
orbit auth login
orbit publish select <session-id>
orbit publish enable
orbit push
```

New projects publish only selected sessions. The dashboard is maintained in the separate `orbit-dashboard` repository and is deployed independently. This package does not contain a web server, browser UI, or hosted account database. The former `orbit serve` command explains how to find the separate dashboard.

## Data and limitations

History and capture state live in `.orbit/` inside your project. Source-code commits and conversation checkpoints are separate. Orbit does not transfer source files or native agent credentials. Long handoffs retain the original goal, latest request, and recent history within the destination's context budget; the CLI reports truncation.

Deleting a session removes it from the current history revision. Older Git commits and native agent transcripts can still contain it.

## Development

```sh
npm run typecheck
npm test
npm run format:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions, [architecture](docs/architecture.md) for module boundaries, and [the protocol](docs/protocol.md) for dashboard compatibility.
