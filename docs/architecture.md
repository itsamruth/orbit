# Git-backed Orbit architecture

Actual Git is the authority for committed conversation history. The code repository and conversation repository are independent.

## Storage and capture

.orbit/history is a normal Git working repository with a versioned orbit.json manifest, workstream/session JSON files, and content-addressed JSONL event chunks. Each chunk holds at most 64 events or approximately 900 KB. Unchanged chunks reuse Git objects. The reader validates paths, regular-file modes, schema versions, identity, parent relationships, event sequences, and chunk hashes.

.orbit/state/journal.sqlite is durable local capture state, not cloud synchronization. It reuses the validated entity repository as a materialized working view plus pending operations. Filtered events, native offsets, and exclusion state enter one SQLite FULL-synchronous transaction. Checkpointing takes a cross-process writer lock, builds a private Git index, writes the tree and commit, and atomically updates the branch using the expected previous head. An intent record allows recovery if Git commits before journal acknowledgement. Git supplies the committed view when the index is rebuilt. Capture offsets and uncommitted journal data are durable state and must not be discarded casually.

Turn-completion markers trigger checkpoints. Unsupported boundaries use 30-second partial checkpoints; session exit drains the transcript and commits a final checkpoint. A single agent owns each checkout. Historical continuation creates a new branch and stores its origin checkpoint in the new session.

Git commands use argument arrays and explicit directories. Git-specific inherited environment variables are cleared, hooks are disabled for ordinary client commands, external remote helpers are disallowed, and subprocess limits are enforced. Source code is inspected but never staged, committed, or checked out by Orbit.

## Transport and portal

Publishing is opt-in per checkout. Workers coalesce checkpoint pushes and retry while an agent wrapper or orbit serve is running. Local commits survive network failure. Pull is fast-forward only. A divergent branch can be preserved under a new name. Conversation merges and force updates are unsupported.

Hosted projects own bare repositories. Git's HTTP backend supplies smart HTTP clone/fetch/push. Orbit authorizes each endpoint and reference advertisement. A server-controlled pre-receive hook validates new snapshots and project identity, rejects event modification and merge commits, and refuses branch deletion/non-fast-forward updates. Repository content is never executed.

The API builds disposable query indexes for Git snapshots. Branch-tip indexing runs after pushes and reconciles every ten seconds. PostgreSQL stores latest indexed revision/error markers. Recent snapshot indexes are cached in process and can be reconstructed from Git. API pagination pins commit IDs so later pushes do not shift pages.

PostgreSQL persists accounts, permissions, email tokens, device credentials, project registration, and indexing status. Git repositories require a persistent filesystem volume and separate backups.

## Authentication

Email links use hashed single-use tokens expiring after 15 minutes. Opening a link does not consume it; same-origin confirmation POST does. Production delivery uses SMTP. Browser credentials use HTTP-only SameSite cookies. Device authorization returns revocable CLI tokens; Git receives them through a repository-scoped askpass helper. Remote URLs do not contain tokens.

Legacy GitHub OAuth remains optional for account migration. An authenticated user can verify and link an email to their existing account. Accounts are never merged based on an unverified email.

The local portal binds to loopback and rejects foreign Host/Origin headers. Hosted project ownership authorizes the entire repository, not individual branches.

## Migration, deletion, and limits

Explicit migration supports SQLite history and authenticated cloud exports. Imports preserve IDs and content except for moving the old publishing preference out of the versioned project. Backups and fingerprints support restart and rollback. Original checkpoint boundaries are not fabricated.

Conversation deletion creates a new commit; earlier revisions retain the record. Hosted repository deletion removes that server copy only. Permanent historical purging, automatic merging, teams, public projects, passive capture, and binary attachments are deferred.

Current limits: 256 KB per normalized entity, 1 MB per event chunk, 100 MB per hosted push, 1,000 new checkpoints per push, and 128 MB decoded snapshot/process output. Oversized or unsupported data fails explicitly. Continuation keeps original/latest objectives and bounded complete tool pairs within native context limits.
