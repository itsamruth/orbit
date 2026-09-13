import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, Check, ChevronDown, Copy, FolderGit2, GitCommitHorizontal, Orbit, Terminal } from "lucide-react";
import type { Project, Session } from "@orbit/contracts";
import { useCollection } from "./api";

export function CopyLine({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <div className="launch-command-wrap">
    <div className="launch-command"><span aria-hidden="true">$</span><code>{command}</code>
      <button type="button" aria-label={"Copy " + command} onClick={async () => {
        if (timer.current) clearTimeout(timer.current);
        try { await navigator.clipboard.writeText(command); setState("copied"); }
        catch { setState("error"); }
        timer.current = setTimeout(() => setState("idle"), 2500);
      }}>{state === "copied" ? <Check size={15} /> : <Copy size={15} />}</button>
    </div>
    <span className="launch-copy-status" role="status">{state === "copied" ? "Copied to clipboard" : state === "error" ? "Select the command and copy it manually." : ""}</span>
  </div>;
}

export function LaunchFlow({ project, sessions = [], compact = false }: { project?: Project; sessions?: Session[]; compact?: boolean }) {
  const [agent, setAgent] = useState(() => {
    try { return localStorage.getItem("orbit-preferred-agent") === "claude" ? "claude" : "codex"; }
    catch { return "codex"; }
  });
  const latest = sessions.slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const currentStep = !project ? 0 : !latest ? 1 : 2;
  const base = project ? "/projects/" + project.id : "";
  const mark = (step: number) => <span className={"launch-step-marker" + (step < currentStep ? " complete" : step === currentStep ? " current" : "")}>{step < currentStep ? <Check size={14} /> : step + 1}</span>;
  return <section className={"launch-flow" + (compact ? " launch-flow--compact" : "")} aria-label="Project setup">
    {!compact && <header className="launch-flow-heading"><Terminal size={18} /><span>{latest ? "Your conversation is ready" : project ? "Capture your first conversation" : "Set up a repository"}</span><span className="launch-step-count">{currentStep === 2 ? "Ready to explore" : "Step " + (currentStep + 1) + " of 3"}</span></header>}
    <ol className="launch-steps">
      <li aria-current={currentStep === 0 ? "step" : undefined}>
        {mark(0)}<div className="launch-step-body"><h3>{project ? "Repository initialized" : "Initialize your repository"}</h3>
          {project ? <p><Link to={base}>{project.name}</Link> is ready for conversation history.</p> : <>
            <p>In your project's terminal, run:</p><CopyLine command="orbit init" />
            <details className="launch-install"><summary>Don't have the Orbit CLI yet?<ChevronDown size={13} /></summary><p>In the Orbit source checkout, install and link the CLI. Then return to your own project directory.</p><CopyLine command="npm install" /><CopyLine command="npm run build" /><CopyLine command="npm link --workspace @orbit/cli" /></details>
          </>}
        </div>
      </li>
      <li aria-current={currentStep === 1 ? "step" : undefined}>
        {mark(1)}<div className="launch-step-body"><h3>{latest ? "First session captured" : "Start your coding agent"}</h3>
          {latest ? <p>{sessions.length} {sessions.length === 1 ? "session is" : "sessions are"} available. You can launch another whenever you need it.</p> : <p>Use the agent you already work with. Orbit records the conversation while you code.</p>}
          <div className="launch-agent-options" role="group" aria-label="Coding agent">
            {(["codex", "claude"] as const).map((name) => <button key={name} type="button" aria-pressed={agent === name} onClick={() => { setAgent(name); try { localStorage.setItem("orbit-preferred-agent", name); } catch { /* The selection still works without storage. */ } }}><span className="launch-agent-icon">{name === "codex" ? <Terminal size={15} /> : <Orbit size={15} />}</span><span>{name === "codex" ? "Codex" : "Claude Code"}</span><span className="launch-radio">{agent === name && <span />}</span></button>)}
          </div>
          <CopyLine command={"orbit " + agent} />
          <p className="launch-hint">The command starts the agent in your terminal. Use your existing agent sign-in.</p>
        </div>
      </li>
      <li aria-current={currentStep === 2 ? "step" : undefined}>
        {mark(2)}<div className="launch-step-body"><h3>{latest ? "Open your conversation" : "See your work in Orbit"}</h3>
          {latest && project ? <><p>Read the conversation, inspect a checkpoint, or continue the same work with another agent.</p><Link className="btn btn-primary" to={base + "/sessions/" + latest.id}>Open latest session<ArrowRight size={14} /></Link></> : project ? <p className="launch-waiting"><span className="launch-waiting-dot" />Waiting for a captured session. This page updates automatically.</p> : <><p>Open a second terminal in the same project and run this. Use the portal URL printed by the CLI.</p><CopyLine command="orbit serve" /><p className="launch-hint">Each local portal shows the repository it was started in.</p></>}
        </div>
      </li>
    </ol>
    {!compact && <footer className="launch-flow-footer"><GitCommitHorizontal size={14} /><span>History stays on your machine. Publish only when you choose.</span></footer>}
  </section>;
}

function ExistingProjectFlow({ project }: { project: Project }) {
  const sessions = useCollection<Session>("/projects/" + project.id + "/sessions");
  if (sessions.isLoading) return <p className="loading" role="status">Checking captured sessions...</p>;
  if (sessions.error) return <div className="flash flash-error" role="alert">{sessions.error.message}<button className="btn" onClick={() => void sessions.refetch()}>Try again</button></div>;
  return <LaunchFlow project={project} sessions={sessions.data?.items ?? []} />;
}

export function GettingStartedPage() {
  const projects = useCollection<Project>("/projects");
  const [params, setParams] = useSearchParams();
  const requested = params.get("project");
  const project = params.get("new") === "1" ? undefined : projects.data?.items.find((p) => requested ? p.id === requested : true);
  return <main className="page first-run-page">
    <aside className="first-run-aside"><Link className="first-run-back" to="/projects"><FolderGit2 size={15} />Your projects</Link><div className="first-run-aside-content"><span className="first-run-eyebrow">GETTING STARTED</span><h1>Your work has a history.<br />Keep it.</h1><p>Bring your agent conversations into the same place, so your next session doesn't start from scratch.</p><div className="first-run-principle"><BookOpen size={16} /><span>Initialize once.<br />Capture as you work.<br />Continue with the context.</span></div></div><p className="first-run-local">Local use needs no Orbit account. Publishing is a separate choice.</p></aside>
    <section className="first-run-content"><div className="first-run-topline"><span>Connect your workflow</span><Link to="/projects">Back to workspace<ArrowRight size={13} /></Link></div>
      <h2>{project ? "Let's get " + project.name + " ready." : "From your terminal to Orbit."}</h2><p className="first-run-intro">Three steps, using the tools you already have.</p>
      {projects.isLoading ? <p className="loading" role="status">Finding your projects...</p> : projects.error ? <div className="flash flash-error" role="alert">{projects.error.message}<button className="btn" onClick={() => void projects.refetch()}>Try again</button></div> : <>
        {!!projects.data?.items.length && <label className="launch-project-picker"><span>Repository</span><select value={project?.id ?? ""} onChange={(e) => setParams(e.target.value ? { project: e.target.value } : { new: "1" })}><option value="">Set up another repository</option>{projects.data.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {project ? <ExistingProjectFlow key={project.id} project={project} /> : <LaunchFlow />}
      </>}
      <details className="launch-publishing"><summary>Need this history on another machine?<ChevronDown size={14} /></summary><p>After capturing locally, point the CLI at your hosted Orbit server, sign in with <code>orbit auth login</code>, then run <code>orbit publish enable</code>. Publishing is opt in for each checkout.</p></details>
    </section>
  </main>;
}
