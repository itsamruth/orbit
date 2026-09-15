# Local viewer and optional hosted publishing

Neither feature is required for your first agent switch. Start with the
[CLI quick start](../README.md#your-first-switch).

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
