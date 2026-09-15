# Claude to Codex: one task, one rejected approach

[Back to Orbit](../README.md) | [60-second animated replay](assets/switch-demo.svg)

## What this demo is

A guided, real-agent run recorded on 2026-09-15 using the local Orbit 0.2.2 build,
Claude Code 2.1.270, Codex CLI 0.154.0, and Node.js 22.14.0. Both agents ran in the
same disposable Git working tree. Publishing and the local viewer were disabled.

The animation is an **annotated text replay**, not native terminal footage.
Its six ten-second scenes condense the recorded conversation and tool results;
setup, model wait time, and most terminal output are omitted. It does not measure
a sixty-second wall-clock switch, token savings, or behavior under a real quota
error. The failed approach was explicitly requested, not discovered independently
by Claude.

Only Claude-to-Codex was exercised for this demo. It is not evidence that every
adapter version, the reverse direction, or every long conversation works.

## Accessible transcript

| Replay time | What happened |
| --- | --- |
| 00-10s | The developer asked Claude to fix duplicate refreshes after concurrent HTTP 401 responses, try a retry-count experiment, and stop before the actual fix. |
| 10-20s | Claude ran the focused test. It failed: expected one refresh, observed two. |
| 20-30s | Claude changed `maxRetries` from 1 to 2 and reran the test. Same failure. Its visible reply explained that retry count does not coordinate concurrent callers and proposed a shared in-flight promise. |
| 30-40s | After exiting Claude, `orbit switch codex` selected the same workstream and launched Codex with the history. |
| 40-50s | Codex inspected the working tree, recognized the failed experiment, and asked what to continue because the stopping point was uncertain. The developer sent only the continuation instruction below. |
| 50-60s | Codex added the shared promise without repeating the retry-count experiment. After resolving a local Node invocation issue, the focused test and all three sample tests passed. |

The actual instruction sent after the handoff was:

```text
Continue with the next step and run the focused test and the full suite. Do not change tests or commit.
```

No new explanation of the bug, failed experiment, or proposed fix was given to
Codex. It did still read the source and inspect Git state. Checking the current
workspace is appropriate; the claim is that the rejected experiment did not have
to be rediscovered, not that the next agent performs no reads.

## Reproduce it

Install and authenticate both agent CLIs separately. Install Orbit:

```sh
npm install -g @itsamruth/orbit
```

From an Orbit source checkout, copy the intentionally buggy sample to a
disposable directory. Do not run the demo against your real application's files.

```sh
DEMO_DIR="$(mktemp -d)"
cp examples/agent-switch/client.mjs examples/agent-switch/client.test.mjs "$DEMO_DIR/"
cd "$DEMO_DIR"
git init -b demo/refresh-race
git add client.mjs client.test.mjs
git commit -m "Reproduce concurrent refresh bug"
export ORBIT_VIEWER=0
orbit init
orbit claude
```

The baseline commit requires your usual Git identity. The sample uses no network
requests, real credentials, or third-party dependencies.

Give Claude this prompt, used in the recorded run:

```text
Fix duplicate token refreshes when two requests return 401 together. This is a guided handoff demo. Read client.mjs and client.test.mjs, run the focused concurrent test, then try increasing maxRetries from 1 to 2 and rerun that test. If it still fails, keep the change for comparison and explain why this approach is rejected. Stop there without implementing the fix: identify the next code change and exact next test command for the next agent. Do not change tests or commit anything.
```

Wait for the failed experiment and explanation, exit Claude, then run:

```sh
orbit switch codex
```

Allow the agent to acknowledge the handoff. Send the short continuation instruction
above. A trust prompt for the disposable project may appear in either CLI.

The focused check is:

```sh
node --test --test-name-pattern="concurrent 401s share one refresh" client.test.mjs
```

The entire sample suite is:

```sh
node --test client.test.mjs
```

To inspect what Orbit retained, use `orbit history` to obtain your workstream ID,
then `orbit context <workstream> --json`. Results include an event cursor for
older history. No dashboard or hosted push is needed.

## Recorded evidence

These are selected output excerpts, with timing noise, absolute paths, and
tool-wrapper metadata omitted. They are not a complete raw transcript.

Before and after Claude's `maxRetries = 2` change:

```text
Exit code 1
not ok 1 - concurrent 401s share one refresh
expected: 1
actual: 2
```

Orbit's switch output included:

```text
From: claude  ->  codex
Preparing context for codex...
Opening codex with this conversation.
```

Codex retained `maxRetries = 2` for comparison, added a closure-level
`pendingRefresh`, and cleared it in `finally` after either success or failure.
It did not change the tests or commit its code.

Final focused-test excerpt:

```text
ok 1 - concurrent 401s share one refresh
# tests 1
# pass 1
# fail 0
```

Final full-sample excerpt:

```text
ok 1 - successful requests do not refresh
ok 2 - concurrent 401s share one refresh
ok 3 - a failed refresh does not block later recovery
# tests 3
# pass 3
# fail 0
```

### Friction retained in the record

- The handoff's stopping state was uncertain. Codex asked for confirmation rather than silently choosing an action.
- A delayed project-trust prompt caused an initial transcript-discovery warning. Codex events were subsequently captured in the same Orbit workstream.
- Codex's shell initially could not find `node`. It used the installed absolute executable path. Its `--test` invocation reported only a file-level result, so it also ran `node client.test.mjs` and `node --test-name-pattern="concurrent 401s share one refresh" client.test.mjs` to obtain the named results above. The animation omits this debugging, not its existence.
- This small fixture's passing tests are not proof of a production-ready HTTP client. In particular, the experimental retry count remained at 2.
- Full raw terminal recordings stay outside the repository. Only selected, sanitized evidence is included here.

### Local evidence identifiers

These IDs locate the original capture if the recording project is retained;
they are not IDs to paste into a fresh reproduction.

| Evidence | Orbit event |
| --- | --- |
| Claude baseline failure | `evt_70c46f4daaf73f9cd9eb081b23c00c1a9b1642e0` |
| Claude failure after retry change | `evt_4028538f30fee92ee198a494a92c81370301a632` |
| Claude rejection and next step | `evt_39b14babe2c16ea9f536da2186d74e2d78f92ef5` |
| Codex recognition of prior attempt | `evt_90d6caf0192a12fd0ea1a6688fed2f74fde802dc` |
| Codex named full-suite result | `evt_25689ecb53826d76657a17c754c60afeddc7cad6` |
| Codex named focused-test result | `evt_4cbd2c1532510dbe8cecadb00b83aa4499f1b952` |

Both agent sessions belong to
`work_09cc581e-b2cb-477a-b1fd-f0693f399adb`. Read-only history retrieval was
also exercised with `orbit context`; it returned schema-version-2 events and
a `nextCursor`.

## What to look for in your own switch

Success is behavioral, not an exact match to either model's wording: the next
agent should identify the objective and current worktree, understand the observed
failure and rejected approach, and use that evidence to choose its next step.
Missing evidence, repeated rejected experiments, or incorrect workspace assumptions
are useful bug reports. Do not publish an unsanitized transcript to report them.
