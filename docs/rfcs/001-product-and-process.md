> Historical product discussion. Storage and synchronization decisions here are superseded by [the Git-backed architecture](../architecture.md).

# RFC 001 — Orbit Product & Process

| Field    | Value                                             |
| -------- | ------------------------------------------------- |
| Product  | Orbit                                             |
| Tagline  | Git for AI agent sessions                         |
| Status   | MVP implemented; live release validation pending  |
| Version  | 0.1                                               |
| Audience | Product, Engineering, Design, Security, Platform  |
| Source   | User-provided RFC 001 in the project conversation |

This is an edited repository copy of the supplied product draft, preserving its scope and requirements. Examples and repetition have been condensed. Engineering proposals in subsequent RFCs are not implemented behavior or approved amendments to this draft.

## 1. Executive summary

Orbit is a project-scoped, cloud-synchronized portability layer for AI coding-agent sessions. A developer starts an agent with `orbit codex`, works normally, and later runs `orbit switch claude`. The destination receives enough session context to continue useful development without manual re-explanation.

The development session belongs to the project and developer, not to the agent vendor. V1 covers capture, synchronization, history, and continuation. It excludes semantic project memory, knowledge graphs, autonomous orchestration, and AI project management.

## 2. Product principles

- **Project first:** every session belongs to a project; unrelated repositories never share session context.
- **Agent agnostic:** adapters translate to and from a common Orbit model.
- **Automatic where possible:** launching through Orbit enables continuous capture without manual exports.
- **Cloud synchronized:** incremental synchronization runs during the session, rather than waiting for exit.
- **Git-aware, not Git-dependent:** Orbit records repository, branch, HEAD, staged, modified, and untracked state. Git owns source history; Orbit owns session history.
- **Continuity over perfect replication:** continuation need not recreate a vendor-native session exactly.

## 3. Terminology

| Term              | Meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| Project           | A registered repository or development project                                   |
| Native session    | A session created by a particular agent                                          |
| Workstream        | A continuous task spanning one or more native sessions                           |
| Universal session | Orbit's normalized representation of a native session                            |
| Event             | A normalized message, tool interaction, command, file change, or Git observation |
| Checkpoint        | A future compact representation of long history; outside the first MVP           |

## 4. Primary user story

Inside an initialized project, `orbit codex` resolves the project, records workspace state, launches Codex, observes and normalizes events, persists locally, and synchronizes to Orbit Cloud.

Later, `orbit switch claude` flushes capture, identifies the current workstream, retrieves missing cloud state when available, inspects Git, constructs a continuation package, launches Claude with that context, and captures its native session under the same workstream.

## 5. Initialization

Initialization is per project, like Git:

```bash
cd ~/projects/relay
orbit init
```

Orbit detects Git and its repository root and remote, generates or resolves project identity, creates local metadata, and registers or connects the cloud project. The conceptual `.orbit/project.json` contains a project ID and no credentials. The scaffold uses the versioned representation `{ "version": 1, "projectId": "prj_..." }`; the original draft illustrated the field as `project_id`.

Commands inside descendants resolve to the same project. Unrelated repositories require their own initialization.

## 6. Launch

`orbit codex` resolves project, branch, and suitable active workstream. If none exists, Orbit creates one. It records project, repository, branch, HEAD, working tree state, agent, user, and start time before launching the agent.

## 7. Workstream creation

Create a new workstream when explicitly requested, when none exists, when the developer declines continuation, or when the workspace is materially unrelated. Commands are `orbit new` and `orbit new "OAuth refresh rotation"`.

## 8. Continue

`orbit claude --continue` continues the most recent suitable workstream in this project. Selection order is active workstream, latest on the same branch, then latest for the project. Ambiguity may prompt a choice; the initial MVP may select the latest automatically.

## 9. Switch

`orbit claude` launches Claude under Orbit. `orbit switch claude` ends or pauses the active agent and continues the same workstream with Claude.

The sequence is flush pending events, record final workspace state, create handoff state, launch destination, hydrate context, and capture the new session.

## 10. Handoff state

Include project, workstream, previous agent and native session, current branch and HEAD, dirty state, modified files, recent conversation, recent commands and tool results, and latest user objective. V1 may reconstruct this from bounded raw history without AI summarization.

## 11. Session capture

Native events pass through an adapter and normalization into universal events, local storage, a sync queue, and cloud storage. Cloud availability must never block agent operation.

## 12. Local-first reliability

Local persistence is mandatory. Events remain pending while offline and synchronize after connectivity returns. The coding session continues uninterrupted.

## 13. Cloud synchronization

Synchronization is incremental and idempotent. If cloud has events 1–320 and local storage has 1–327, upload 321–327. Retrying an event must not create duplicates.

## 14. Session finalization

Exit, crash, rate limit, terminal closure, or switching may end a native session. Record `session_ended` where possible. Unexpected termination can produce `interrupted` after process or inactivity checks.

## 15. Session history

`orbit history` lists the project's workstreams and their sequence of agent sessions, including activity times.

## 16. Project cloud experience

The web app organizes content under projects, with sessions, workstreams, activity, members, and settings. Members and team workflows are future scope.

## 17. Naming

Title priority is explicit user title, meaningful issue or branch name, first significant user request, then placeholder. Titles remain editable.

## 18. Agent support

V1 supports Codex and Claude Code. V1.1 adds Cursor. Later adapters may support Gemini CLI, Kiro, GitHub Copilot, OpenCode, Windsurf, and others. Adding an adapter must not require changing the cloud domain model.

## 19. Adapter responsibilities

Each adapter implements capture from native events and continuation from Orbit context. Adapters communicate through the universal model, never directly with one another.

## 20. Workspace validation

Compare previous and current repository, branch, and HEAD before continuation. Warn when materially different. V1 does not restore branches or otherwise modify source state automatically.

## 21. Dirty workspaces

Orbit records uncommitted state but never commits automatically. Local agents use files already present. Cross-machine continuation does not promise portability of uncommitted source code.

## 22. Multiple devices

Cloud provides conversation, history, commands, and metadata. Git provides source state. Display expected repository, branch, and HEAD so the user can align the workspace.

## 23. Team future

Shared projects and authorized cross-user continuation are future scope, including a possible `orbit continue work_123 --agent claude` command. They are not required for V1.

## 24. Security

Capture should eventually include local filtering and redaction before synchronization. Sensitive categories include tokens, API keys, passwords, private keys, and customer data. V1 must at least provide configurable exclusions and clear warnings about synchronized content.

## 25. Deletion

Users must be able to delete Orbit copies of native sessions, workstreams, projects, and cloud history, for example through `orbit session delete sess_123` or the web UI. Deletion semantics must be documented explicitly.

## 26. Failures

| Failure                           | Required behavior                                                     |
| --------------------------------- | --------------------------------------------------------------------- |
| Cloud unavailable                 | Continue locally                                                      |
| Adapter crashes                   | Keep agent operation unaffected where technically possible            |
| Duplicate event                   | Deduplicate by event ID                                               |
| Native session undiscoverable     | Show a clear adapter error                                            |
| Destination cannot accept context | Fail before launch; context-free launch requires explicit user choice |
| Project or workspace mismatch     | Warn; never silently mix projects                                     |
| History exceeds context budget    | Bound recent history; checkpoints come later                          |

## 27. Success criteria

The primary acceptance scenario is useful Codex-to-Claude task continuation without manual context re-entry. The primary metric is manual context re-entry, targeted near zero for normal coding sessions. Secondary metrics are switch success, capture completeness, cloud lag, continuation acceptance, and adapter stability.

## 28. MVP scope

Required: CLI authentication, project initialization, Codex and Claude adapters, universal events, SQLite, cloud sync, project-scoped sessions and workstreams, Git metadata, history, switching, and a basic project/session web viewer.

Excluded: graph memory, AI summaries, orchestration, semantic search, automatic source synchronization, team handoff, and mobile apps.

## 29. Build order

Approved revision: shared contracts → frontend with isolated fixtures → cloud API and persistence → local capture and filtering → sync → bidirectional continuation → integrated verification and deployment artifacts. Individuals first; hosted web viewer plus CLI-owned agents. Conversation version control and teams remain post-MVP.

## 30. Product definition

Orbit is a project-scoped cloud session layer that lets developers move active coding work between AI agents. The first defining experience is `orbit switch claude` continuing the work already underway.
