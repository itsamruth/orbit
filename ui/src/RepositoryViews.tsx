import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  Checkpoint,
  Page,
  RepositoryStatus,
  Session,
} from "../../src/protocol/index";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  GitBranch,
  GitCommitHorizontal,
  MessageSquare,
  Search,
} from "lucide-react";
import { useApi, request, revisionPath } from "./api";
/** Conversation-branch toolbar. `children` holds the source-branch filter so
 *  both selectors share a single row, the way GitHub groups branch controls. */
export function RepositoryControls({ children }: { children?: ReactNode }) {
  const { projectId } = useParams(),
    [params, setParams] = useSearchParams();
  const q = useApi<RepositoryStatus>("/projects/" + projectId + "/status");
  const s = q.data;
  if (!s)
    return q.error ? (
      <p role="alert" className="flash flash-error">
        {q.error.message}
      </p>
    ) : (
      <div className="branchbar">{children}</div>
    );
  return (
    <>
      <div className="branchbar">
        <span className="branchbar-select">
          <GitBranch size={14} />
          <select
            aria-label="Conversation branch"
            value={params.get("branch") ?? s.branch ?? "main"}
            onChange={(e) => setParams({ branch: e.target.value })}
          >
            {s.branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </span>
        <Link
          className="btn btn-sm"
          to={
            "/projects/" +
            projectId +
            "/checkpoints" +
            (params.get("branch")
              ? "?branch=" + encodeURIComponent(params.get("branch")!)
              : "")
          }
        >
          <GitCommitHorizontal size={14} />
          Checkpoints
        </Link>
        <Link className="btn btn-sm" to={"/projects/" + projectId + "/memory"}>
          <Search size={14} />
          Search history
        </Link>
        {children}
        {params.get("revision") ? (
          <span className="Label">
            Historical checkpoint{" "}
            <code>{params.get("revision")!.slice(0, 8)}</code>
            <button className="btn-link" onClick={() => setParams({})}>
              Return to latest
            </button>
          </span>
        ) : null}
        <details className="branchbar-status repository-status">
          <summary>
            <span
              className={"dot" + (s.uncheckpointed === 0 ? " dot--on" : "")}
            />
            {s.mode === "local"
              ? s.uncheckpointed
                ? s.uncheckpointed + " pending changes"
                : "All changes checkpointed"
              : s.indexedRevision === s.head
                ? "Up to date"
                : "Indexing..."}
          </summary>
          <div>
            {s.mode === "local"
              ? s.uncheckpointed +
                " changes awaiting a checkpoint. The viewer includes captured activity immediately."
              : s.indexedRevision === s.head
                ? "Latest push indexed"
                : "Indexing latest push…"}
          </div>
        </details>
      </div>
      {s.publishing.error ? (
        <p role="alert" className="flash flash-warn">
          Publishing needs attention. Your local history is saved. Run{" "}
          <code>orbit push</code> to inspect the error.
        </p>
      ) : null}
    </>
  );
}
export function CheckpointsPage() {
  const { projectId } = useParams(),
    [params] = useSearchParams(),
    base = "/projects/" + projectId;
  const query = useInfiniteQuery({
    queryKey: [revisionPath(base + "/checkpoints")],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      request<Page<Checkpoint>>(
        base +
          "/checkpoints" +
          (pageParam ? "?cursor=" + encodeURIComponent(pageParam) : ""),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 2000,
  });
  const q = {
    error: query.error,
    data: query.data
      ? { items: query.data.pages.flatMap((p) => p.items) }
      : undefined,
  };
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const diff = useApi<{
    from: string;
    to: string;
    changes: {
      id: string;
      kind: string;
      action: string;
      before: unknown;
      after: unknown;
    }[];
  }>(
    base +
      "/compare?from=" +
      encodeURIComponent(from) +
      "&to=" +
      encodeURIComponent(to),
    Boolean(from && to),
  );
  return (
    <>
      <div className="Subhead">
        <h1 className="Subhead-heading">Conversation checkpoints</h1>
        <p className="Subhead-description">
          Each checkpoint is a Git commit. Open one to browse or continue its
          history.
        </p>
      </div>
      {q.error ? (
        <p role="alert" className="flash flash-error">
          {q.error.message}
        </p>
      ) : null}
      <div className="Box">
        <div className="Box-header">
          <h3 className="Box-title">
            <GitCommitHorizontal size={16} />
            History
            {params.get("branch") ? (
              <span className="muted">on {params.get("branch")}</span>
            ) : null}
          </h3>
        </div>
        {q.data?.items.map((c) => (
          <div className="checkpoint-row" key={c.oid}>
            <div>
              <Link to={base + "?revision=" + c.oid}>
                <strong>{c.message}</strong>
              </Link>
              <p>
                {c.author} · {new Date(c.createdAt).toLocaleString()}
              </p>
            </div>
            <code>{c.oid.slice(0, 10)}</code>
          </div>
        ))}
      </div>
      {query.hasNextPage && (
        <button
          className="btn"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          Load older checkpoints
        </button>
      )}
      <div className="Subhead" style={{ marginTop: 32 }}>
        <h2 className="Subhead-heading">Compare conversations</h2>
      </div>
      <div className="branchbar">
        <label className="inline small muted">
          From
          <select
            aria-label="Compare from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">Select checkpoint</option>
            {q.data?.items.map((c) => (
              <option key={c.oid} value={c.oid}>
                {c.oid.slice(0, 8)} {c.message}
              </option>
            ))}
          </select>
        </label>
        <label className="inline small muted">
          To
          <select
            aria-label="Compare to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Select checkpoint</option>
            {q.data?.items.map((c) => (
              <option key={c.oid} value={c.oid}>
                {c.oid.slice(0, 8)} {c.message}
              </option>
            ))}
          </select>
        </label>
      </div>
      {diff.error ? (
        <p role="alert" className="flash flash-error">
          {diff.error.message}
        </p>
      ) : null}
      {diff.data?.changes.map((c) => (
        <article className={"diff-record " + c.action} key={c.id}>
          <h3>
            {c.action} {c.kind} <code>{c.id}</code>
          </h3>
          {c.before !== null ? (
            <details>
              <summary>Before</summary>
              <pre>{JSON.stringify(c.before, null, 2)}</pre>
            </details>
          ) : null}
          {c.after !== null ? (
            <pre>{renderChange(c.after)}</pre>
          ) : (
            <p>
              Removed from this revision; earlier commits retain this record.
            </p>
          )}
        </article>
      ))}
      {diff.data && !diff.data.changes.length ? (
        <p className="muted small">No conversation changes.</p>
      ) : null}
    </>
  );
}
function renderChange(data: unknown) {
  const x = data as {
    payload?: { type: string; text?: string; output?: string };
  };
  return x.payload?.text ?? x.payload?.output ?? JSON.stringify(data, null, 2);
}
