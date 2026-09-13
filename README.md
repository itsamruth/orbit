# Orbit CLI

Orbit CLI captures Codex and Claude Code conversations beside a source repository and stores the history in Git. It can continue the latest conversation in another agent when a provider limit is reached.

## Install from npm

The package is prepared for publication as `@orbit/cli`:

```bash
npm install --global @orbit/cli
```

The npm scope must be confirmed before the first public release.

## Core workflow

```bash
cd /path/to/project
orbit init
orbit claude

# Exit Claude, then continue the latest conversation in Codex.
orbit switch codex
```

Orbit prints the selected conversation, source agent, session ID, and latest activity before opening the destination agent. The inverse command is `orbit switch claude`.

To publish private conversation history to an Orbit Dashboard:

```bash
export ORBIT_SERVER_URL=https://orbit.example.com
orbit auth login
orbit publish enable
orbit push
```

## Development

Requires Node.js 22.14 or newer, Git, and the native agent CLIs you intend to use.

```bash
npm install
npm run build
npm link --workspace @orbit/cli
npm test
```

`orbit serve` starts the embedded local-only portal. The hosted account service lives in the separate `orbit-dashboard` repository.
