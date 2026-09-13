# Verification

Verified in the Git-backend implementation working copy:

- TypeScript references, production frontend, and standalone CLI bundle build successfully.
- The full 43-test Node suite passed with real PostgreSQL 16 enabled. Coverage includes Git checkpoints, branches, clone/push/pull, divergence, crash recovery, 10,000-event history, authenticated HTTP Git transport, malformed-push rejection, immutable pagination, read-only history, safe checkout validation, migration, publishing, packaged local portal, email authentication, and legacy compatibility.
- A final continuation regression was added and passed: a workstream removed from the current branch can be continued from an earlier checkpoint. The existing Codex → Claude → Codex process-switching test was rerun and passed alongside it. There are now 44 Node test cases.
- All eight Playwright cases passed. The Git-history case was rerun after replacing a timing-sensitive assertion with an assertion that waits for checkpoint options. It verifies branches, historical conversations, comparisons, and continuation at a checkpoint. Other cases cover connected settings persistence, fixture navigation, deletion, responsive layouts, theme, devices, errors, and long transcript pagination.
- The packaged CLI serves its included production frontend. The local portal rejects foreign origins.
- Git integration verifies source HEAD, index, and code contents remain unchanged.
- Formatting checks passed. A Git-backed portal screenshot is stored in screenshots/git-history.png.

The current application uses the Git-backed API. The old server and sync module remain as legacy regression/import support; they are not the production entrypoint or current CLI transport.

Agent-process fixtures do not call real models. SMTP delivery was injected in authentication tests; a live production email provider was not configured. Real authenticated Codex/Claude tasks, public HTTPS deployment, a coordinated repository/database restore drill, and npm publication remain release gates. Docker/Compose deployment files were updated; the full deployment stack was not launched.

A pre-change source backup was retained outside the project before installation.
