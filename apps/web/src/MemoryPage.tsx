import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BrainCircuit, Database, LockKeyhole, Search, UploadCloud } from "lucide-react";
import type {
  ImportCandidate,
  IntelligenceSettings,
  Page,
  ProviderStatus,
  SearchResult,
  Session,
  SessionSummary,
} from "@orbit/contracts";
import { request, useApi } from "./api";
import "./memory.css";

export default function MemoryPage() {
  const { projectId = "" } = useParams();
  const candidates = useApi<{ items: ImportCandidate[] }>("/projects/" + projectId + "/import/candidates");
  const providers = useApi<{ items: ProviderStatus[] }>("/projects/" + projectId + "/providers");
  const settings = useApi<IntelligenceSettings>("/projects/" + projectId + "/intelligence/settings");
  const sessions = useApi<Page<Session>>("/projects/" + projectId + "/sessions");
  const summaries = useApi<Page<SessionSummary>>("/projects/" + projectId + "/summaries");
  const publication = useApi<{ sessionIds: string[] }>("/projects/" + projectId + "/publish/selection");
  const [imports, setImports] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [provider, setProvider] = useState<"codex" | "claude">("codex");
  const [auto, setAuto] = useState(true);
  const [summarizeImports, setSummarizeImports] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState("");
  const [queued, setQueued] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (settings.data?.provider) setProvider(settings.data.provider);
    if (settings.data) setAuto(settings.data.autoSummarize);
  }, [settings.data]);
  useEffect(() => {
    if (publication.data) setSelected(publication.data.sessionIds);
  }, [publication.data]);
  useEffect(() => {
    if (!queued.length) return;
    const timer = window.setInterval(() => void summaries.refetch(), 2500);
    return () => window.clearInterval(timer);
  }, [queued.length]);
  useEffect(() => {
    if (summaries.data)
      setQueued((current) => current.filter((id) => !summaries.data!.items.some((summary) => summary.sessionId === id)));
  }, [summaries.data]);
  const refresh = () => {
    void candidates.refetch();
    void sessions.refetch();
    void summaries.refetch();
    void publication.refetch();
  };
  const toggle = (list: string[], id: string, setter: (next: string[]) => void) =>
    setter(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]);
  return (
    <main className="memory-page">
      <header className="memory-hero">
        <div><span className="memory-kicker">PROJECT MEMORY</span><h1>The work behind the code.</h1><p>Import native agent history, find exact decisions, and create durable summaries with the tools you already use.</p></div>
        <LockKeyhole size={28} /><span>Raw history stays local until you select a session to publish.</span>
      </header>
      {message && <p className="flash" role="status">{message}</p>}
      <section className="memory-grid">
        <article className="memory-card memory-import">
          <header><Database size={18} /><div><h2>Existing conversations</h2><p>Detected from this repository's Claude Code and Codex folders.</p></div></header>
          {candidates.error ? <p className="muted">Historical import is available in the local portal or with <code>orbit import</code>.</p> : null}
          {candidates.data?.items.filter((item) => item.importState !== "current").map((item) => <label className="memory-row" key={item.id}><input type="checkbox" checked={imports.includes(item.id)} disabled={item.importState === "conflict"} onChange={() => toggle(imports, item.id, setImports)} /><span><strong>{item.firstPrompt ?? item.nativeSessionId}</strong><small>{item.agent} · {new Date(item.updatedAt).toLocaleString()} · {item.messageCount} messages</small></span><em>{item.importState}</em></label>)}
          {candidates.data && !candidates.data.items.some((item) => item.importState !== "current") && <p className="muted">No new matching conversations found.</p>}
          <label className="memory-check"><input type="checkbox" checked={summarizeImports} onChange={(event) => setSummarizeImports(event.target.checked)} /> Summarize selected imports with the configured provider</label>
          <button className="btn btn-primary" disabled={!imports.length || Boolean(busy)} onClick={async () => { setBusy("import"); setMessage(""); try { await request("/projects/" + projectId + "/import", { method: "POST", body: JSON.stringify({ candidateIds: imports, summarize: summarizeImports }) }); setImports([]); setMessage("Selected conversations were imported into private Orbit history."); refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); } finally { setBusy(""); } }}>Import {imports.length || "selected"}</button>
        </article>
        <article className="memory-card">
          <header><BrainCircuit size={18} /><div><h2>Context engine</h2><p>One isolated, tool-free job runs after each completed session.</p></div></header>
          <div className="provider-list">{providers.data?.items.map((item) => <label className="provider-row" key={item.id}><input type="radio" name="provider" checked={provider === item.id} disabled={item.status !== "ready"} onChange={() => setProvider(item.id)} /><span><strong>{item.id === "claude" ? "Claude Code" : "Codex"}</strong><small>{item.version ?? item.message}</small></span><em className={item.status === "ready" ? "ready" : ""}>{item.status.replaceAll("_", " ")}</em></label>)}</div>
          <label className="memory-check"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /> Automatically summarize successfully completed sessions</label>
          <button className="btn" disabled={Boolean(busy)} onClick={async () => { setBusy("settings"); try { await request("/projects/" + projectId + "/intelligence/settings", { method: "PUT", body: JSON.stringify({ provider, autoSummarize: auto, maxInputBytes: 48000 }) }); setMessage("Context engine settings saved locally."); void settings.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "Settings failed"); } finally { setBusy(""); } }}>Save context engine</button>
        </article>
      </section>
      <section className="memory-card memory-search">
        <header><Search size={18} /><div><h2>Search project history</h2><p>Lexical search runs locally and never calls a model.</p></div></header>
        <form onSubmit={async (event) => { event.preventDefault(); if (!query.trim()) return; setBusy("search"); try { const data = await request<{ items: SearchResult[] }>("/projects/" + projectId + "/search?q=" + encodeURIComponent(query)); setResults(data.items); } catch (error) { setMessage(error instanceof Error ? error.message : "Search failed"); } finally { setBusy(""); } }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search decisions, messages, commands, files..." /><button className="btn btn-primary">Search</button></form>
        <div className="search-results">{results.map((result) => <Link key={result.id} to={"/projects/" + projectId + "/sessions/" + result.sessionId}><span><strong>{result.title}</strong><small>{result.agent} · {result.type} · {new Date(result.occurredAt).toLocaleString()}</small></span><p>{result.snippet}</p></Link>)}{query && !busy && !results.length ? <p className="muted">No matching project history.</p> : null}</div>
      </section>
      <section className="memory-grid">
        <article className="memory-card">
          <header><BrainCircuit size={18} /><div><h2>Knowledge</h2><p>Structured summaries remain linked to their source conversation.</p></div></header>
          {summaries.data?.items.map((summary) => <div className="summary-card" key={summary.id}><div><strong>{summary.title}</strong><small>{summary.provider} · {summary.coverage} coverage</small></div><p>{summary.overview}</p>{summary.decisions.length > 0 && <span>{summary.decisions.length} decisions</span>}{summary.tasks.length > 0 && <span>{summary.tasks.length} tasks</span>}</div>)}
          {sessions.data?.items.filter((session) => !summaries.data?.items.some((summary) => summary.sessionId === session.id)).map((session) => <div className="memory-row" key={session.id}><span><strong>{session.agent} conversation</strong><small>{session.captureMode ?? "live"} · {session.status}</small></span><button className="btn btn-sm" disabled={Boolean(busy) || queued.includes(session.id)} onClick={async () => { setBusy(session.id); try { await request("/projects/" + projectId + "/sessions/" + session.id + "/summary", { method: "POST", body: "{}" }); setQueued((current) => [...new Set([...current, session.id])]); setMessage("Summary job completed with the configured local provider."); void summaries.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "Summary failed"); } finally { setBusy(""); } }}>{queued.includes(session.id) ? "Queued" : "Summarize"}</button></div>)}
        </article>
        <article className="memory-card">
          <header><UploadCloud size={18} /><div><h2>Publish selection</h2><p>Only complete sessions selected here enter the publication projection.</p></div></header>
          {sessions.data?.items.map((session) => <label className="memory-row" key={session.id}><input type="checkbox" checked={selected.includes(session.id)} onChange={() => toggle(selected, session.id, setSelected)} /><span><strong>{session.agent} · {session.nativeSessionId.slice(0, 10)}</strong><small>{session.captureMode ?? "live"} · {session.status}</small></span></label>)}
          <button className="btn" disabled={Boolean(busy)} onClick={async () => { setBusy("publish"); try { await request("/projects/" + projectId + "/publish/selection", { method: "PUT", body: JSON.stringify({ sessionIds: selected }) }); setMessage("Publication selection saved. Run orbit push to publish the projection."); void publication.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "Selection failed"); } finally { setBusy(""); } }}>Save publication selection</button>
          <p className="memory-warning">Removing a previously published session stops future inclusion but does not erase earlier Git commits.</p>
        </article>
      </section>
    </main>
  );
}
