import {
  useState,
  lazy,
  Suspense,
  type ReactNode,
  type ComponentProps,
} from "react";
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpen,
  GitBranch,
  GitCommitHorizontal,
  MessageSquare,
  Activity,
  Settings,
  Search,
  Plus,
  ArrowRight,
  Terminal,
  LockKeyhole,
  ChevronDown,
  Copy,
  Check,
  X,
  Moon,
  Sun,
  Laptop,
  CircleDot,
  CircleCheck,
  CircleSlash,
  Clock3,
  FolderGit2,
  Info,
} from "lucide-react";
import { OrbitMark } from "./OrbitMark";
const Markdown = lazy(() => import("./Markdown"));
import type {
  Project,
  Session,
  Workstream,
  UniversalEvent,
  Page,
  Checkpoint,
} from "../../src/protocol/index";
import { request, useApi, useCollection } from "./api";

import { RepositoryControls, CheckpointsPage } from "./RepositoryViews";
import { revisionPath } from "./api";

function keepRevision(to: ComponentProps<typeof RouterLink>["to"]) {
  if (
    typeof to !== "string" ||
    !to.startsWith("/projects/") ||
    to.includes("?")
  )
    return to;
  return to + window.location.search;
}
function Link(props: ComponentProps<typeof RouterLink>) {
  return <RouterLink {...props} to={keepRevision(props.to)} />;
}
function NavLink(props: ComponentProps<typeof RouterNavLink>) {
  return <RouterNavLink {...props} to={keepRevision(props.to)} />;
}
const demo = false;
const revisionParam = () =>
  new URLSearchParams(window.location.search).get("revision");
const age = (value: string) => {
  const mins = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  return mins < 1
    ? "just now"
    : mins < 60
      ? mins + "m ago"
      : mins < 1440
        ? Math.floor(mins / 60) + "h ago"
        : Math.floor(mins / 1440) + "d ago";
};
const agentName = (s: string) =>
  s === "codex" ? "Codex" : s === "claude" ? "Claude Code" : s;
const agentMark = (s: string) =>
  s === "codex" ? "Cx" : s === "claude" ? "Cl" : s.slice(0, 2).toUpperCase();
const agentLogo = (s: string) =>
  s === "codex"
    ? "/openai-logo.svg"
    : s === "claude"
      ? "/claude-logo.svg"
      : null;
function Agent({ name, large }: { name: string; large?: boolean }) {
  const logo = agentLogo(name);
  return (
    <span
      className={"agent " + name + (large ? " agent--lg" : "")}
      title={agentName(name)}
      aria-hidden="true"
    >
      {logo ? <img src={logo} alt="" /> : agentMark(name)}
    </span>
  );
}
function Label({ children }: { children: ReactNode }) {
  return <span className="Label">{children}</span>;
}
function Counter({ children }: { children: ReactNode }) {
  return <span className="Counter">{children}</span>;
}
function SessionState({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "open"
      : status === "interrupted"
        ? "closed"
        : "neutral";
  const Icon =
    status === "active"
      ? CircleDot
      : status === "interrupted"
        ? CircleSlash
        : CircleCheck;
  return (
    <span className={"State State--" + tone}>
      <Icon size={12} />
      {status}
    </span>
  );
}
function Async({
  error,
  loading,
  children,
}: {
  error?: Error | null;
  loading?: boolean;
  children?: ReactNode;
}) {
  if (loading)
    return (
      <div className="loading" role="status">
        <span className="spinner" />
        Loading…
      </div>
    );
  if (error)
    return (
      <div className="flash flash-error" role="alert">
        {error.message}
        <button className="btn" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  return <>{children}</>;
}
function Blankslate({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="blankslate">
      <FolderGit2 size={24} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
function Modal({
  trigger,
  title,
  children,
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal">
          <div className="modal-header">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {title} options and details
            </Dialog.Description>
            <Dialog.Close className="btn-octicon" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="command">
      <code>{text}</code>
      <button
        className="btn-octicon"
        aria-label="Copy command"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            setError("Select and copy the command manually.");
          }
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
      {error && (
        <small role="status" className="muted">
          {error}
        </small>
      )}
    </div>
  );
}
function LaunchFlow({
  compact = false,
}: {
  project?: Project;
  sessions?: Session[];
  compact?: boolean;
}) {
  return (
    <section className={compact ? "local-quickstart" : "Box local-quickstart"}>
      <h3>Start in your project directory</h3>
      <p>
        Initialize the project, then launch your agent. Captured conversations
        appear here automatically.
      </p>
      <Command text="orbit init" />
      <Command text="orbit claude" />
      <p>Already have conversations? Import them from this project:</p>
      <Command text="orbit import" />
      <p>To switch agents, exit the current agent and run:</p>
      <Command text="orbit switch codex" />
    </section>
  );
}
function Setup() {
  return <LaunchFlow compact />;
}
function Continue({
  workstream,
  workspace,
}: {
  workstream: Workstream;
  workspace?: { branch: string | null; head: string | null; dirty: boolean };
}) {
  const [agent, setAgent] = useState("claude");
  const revision = revisionParam();
  return (
    <Modal
      title="Continue this workstream"
      trigger={
        <button className="btn btn-primary">
          <Terminal size={14} />
          Continue
          <ChevronDown size={14} />
        </button>
      }
    >
      <p>
        Run this in the project directory on the machine where you want to
        continue.
      </p>
      <label className="FormControl">
        <span>Continue with</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <Command
        text={
          "orbit continue " +
          workstream.id +
          " --agent " +
          agent +
          (revision ? " --at " + revision : "")
        }
      />
      <div className="note">
        <GitBranch size={14} />
        <span>
          Expected branch{" "}
          <code>{workspace?.branch ?? workstream.branch ?? "none"}</code>
          {workspace?.head && (
            <>
              {" at commit "}
              <code>{workspace.head.slice(0, 7)}</code>
            </>
          )}
          .{" "}
          {workspace?.dirty
            ? "The previous workspace had uncommitted changes; Orbit does not transfer source files."
            : "Align source files through Git before continuing elsewhere."}
        </span>
      </div>
    </Modal>
  );
}

function Shell() {
  const [theme, setTheme] = useState(
    localStorage.getItem("orbit-theme") ?? "light",
  );
  const health = useApi<{ service: string }>("/viewer/health");
  return (
    <div className="app">
      <header className="AppHeader">
        <div className="AppHeader-inner">
          <Link className="AppHeader-logo" to="/projects">
            <OrbitMark size={34} title="Orbit" />
            <span>Orbit</span>
          </Link>
          <nav className="AppHeader-nav" aria-label="Global">
            <Link to="/projects">Projects</Link>
            <Link to="/onboarding">Quickstart</Link>
          </nav>
          <div className="AppHeader-actions">
            <span className="local-status" role="status">
              <span className={"dot" + (health.error ? "" : " dot--on")} />
              {health.error ? "Disconnected" : "Local history"}
            </span>
            <button
              className="btn-octicon"
              aria-label="Toggle color theme"
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                setTheme(next);
                document.documentElement.dataset.theme = next;
                localStorage.setItem("orbit-theme", next);
              }}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>
      {health.error && (
        <div className="local-connection flash flash-warn" role="status">
          The local dashboard is disconnected. Run <code>orbit dashboard</code>{" "}
          to reconnect. This page will retry automatically.
        </div>
      )}
      <Outlet />
      <footer className="footer">
        <div className="footer-inner">
          <OrbitMark size={27} />
          <span>Git for AI agent conversations.</span>
          <nav className="footer-nav">
            <span>Stored on this computer</span>
            <Link to="/onboarding">Quickstart</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
function Dashboard() {
  const q = useCollection<Project & { root: string }>("/projects");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated");
  const items = (q.data?.items ?? [])
    .filter((p) =>
      (p.name + " " + p.description + " " + p.root)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  return (
    <main className="page workspace-page">
      <aside className="workspace-nav" aria-label="Workspace">
        <div className="workspace-identity">
          <span className="workspace-avatar">
            <OrbitMark size={34} />
          </span>
          <div>
            <strong>Your workspace</strong>
            <span>On this computer</span>
          </div>
        </div>
        <nav>
          <Link
            to="/projects"
            className="workspace-nav-item selected"
            aria-current="page"
          >
            <FolderGit2 size={16} />
            Projects<Counter>{q.data?.items.length ?? 0}</Counter>
          </Link>
          <Link to="/onboarding" className="workspace-nav-item">
            <BookOpen size={16} />
            Quickstart
          </Link>
        </nav>
        <div className="workspace-note">
          <Laptop size={16} />
          <p>
            Saved by Orbit.
            <br />
            Updated automatically.
          </p>
        </div>
      </aside>
      <section className="workspace-content">
        <div className="Subhead">
          <div>
            <span className="workspace-eyebrow">YOUR WORKSPACE</span>
            <h1 className="Subhead-heading">Projects</h1>
            <p className="workspace-description">
              Your code has history. Your conversations do too.
            </p>
          </div>
          <div className="Subhead-actions">
            <Modal
              title="Add a project"
              trigger={
                <button className="btn btn-primary">
                  <Plus size={14} />
                  Add project
                </button>
              }
            >
              <Setup />
            </Modal>
          </div>
        </div>
        <div className="listing-toolbar">
          <div className="FormControl-search">
            <Search size={14} />
            <input
              aria-label="Find a project"
              placeholder="Find a project..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Sort projects"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select>
        </div>
        <Async loading={q.isLoading} error={q.error}>
          {!!q.data?.unavailable.length && (
            <p role="status" className="flash flash-warn">
              {q.data.unavailable.length} registered project(s) could not be
              opened. If you moved a project, run <code>orbit dashboard</code>{" "}
              in its new directory.
            </p>
          )}
          <div className="project-directory">
            <div className="directory-heading">
              <span>
                <FolderGit2 size={16} />
                {items.length} {items.length === 1 ? "project" : "projects"}
              </span>
              <span>Last activity</span>
            </div>
            <ul className="repo-list">
              {items.map((p) => (
                <li className="repo-item" key={p.id}>
                  <div className="repo-item-main">
                    <div className="repo-item-title">
                      <BookOpen size={17} className="muted" />
                      <Link to={"/projects/" + p.id}>
                        <h2>{p.name}</h2>
                      </Link>
                      <Label>Local</Label>
                    </div>
                    <p className="repo-item-description">
                      {p.description || p.root}
                    </p>
                    <div className="repo-item-meta">
                      <span>
                        <span className="dot dot--on" />
                        Automatic updates
                      </span>
                      {p.repository && (
                        <span>
                          <FolderGit2 size={12} />
                          {p.repository}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="project-row-end">
                    <time
                      dateTime={p.updatedAt}
                      title={new Date(p.updatedAt).toLocaleString()}
                    >
                      {age(p.updatedAt)}
                    </time>
                    <Link className="btn btn-sm" to={"/projects/" + p.id}>
                      Open project
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {!q.data?.items.length && (
              <Blankslate title="Your conversations start here">
                Run <code>orbit init</code> in a project, then{" "}
                <code>orbit claude</code> or <code>orbit codex</code>. For an
                existing Orbit project, run <code>orbit dashboard</code> there
                once.
              </Blankslate>
            )}
            {!!q.data?.items.length && !items.length && (
              <Blankslate title="No matching projects">
                Try another project name or path.
              </Blankslate>
            )}
          </div>
        </Async>
        <div className="workspace-start">
          <Terminal size={20} />
          <div>
            <strong>Keep your next conversation</strong>
            <p>Capture it once. Continue it with any supported agent.</p>
          </div>
          <Link className="btn" to="/onboarding">
            Quickstart
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </main>
  );
}
type Context = {
  project: Project;
  workstreams: Workstream[];
  sessions: Session[];
  branch: string;
};
function ProjectLayout() {
  const { projectId } = useParams();
  const project = useApi<Project>("/projects/" + projectId);
  const ws = useCollection<Workstream>(
    "/projects/" + projectId + "/workstreams",
  );
  const sessions = useCollection<Session>(
    "/projects/" + projectId + "/sessions",
  );
  const [branch, setBranch] = useState("all");
  const base = "/projects/" + projectId;
  const branches = [
    ...new Set(ws.data?.items.map((w) => w.branch).filter(Boolean) ?? []),
  ];
  const sourceFilter = (
    <>
      <span className="branchbar-select">
        <GitBranch size={14} />
        <select
          aria-label="Filter source code branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          <option value="all">All source branches</option>
          {branches.map((b) => (
            <option key={b!}>{b}</option>
          ))}
        </select>
      </span>
      <span className="small muted">{branches.length} source branches</span>
    </>
  );
  return (
    <Async
      loading={project.isLoading || ws.isLoading || sessions.isLoading}
      error={project.error ?? ws.error ?? sessions.error}
    >
      {project.data && (
        <>
          <div className="repo-header">
            <div className="container">
              <div className="repo-breadcrumb">
                <BookOpen size={16} />
                <Link to="/projects">{project.data.owner}</Link>
                <span className="sep">/</span>
                <Link to={base} className="repo-name">
                  {project.data.name}
                </Link>
                <Label>
                  <Laptop size={11} />
                  Local
                </Label>
                <div className="repo-header-actions">
                  <span className="Label">
                    <span
                      className={
                        "dot" +
                        (project.data.cloudSyncEnabled ? " dot--on" : "")
                      }
                    />
                    {project.data.cloudSyncEnabled
                      ? "Local history"
                      : "Local only"}
                  </span>
                </div>
              </div>
              <nav className="UnderlineNav" aria-label="Project">
                <NavLink className="UnderlineNav-item" to={base} end>
                  <BookOpen size={16} />
                  <span>Overview</span>
                </NavLink>
                <NavLink
                  className="UnderlineNav-item"
                  to={base + "/workstreams"}
                >
                  <GitBranch size={16} />
                  <span>Workstreams</span>
                  <Counter>{ws.data?.items.length ?? 0}</Counter>
                </NavLink>
                <NavLink className="UnderlineNav-item" to={base + "/sessions"}>
                  <MessageSquare size={16} />
                  <span>Sessions</span>
                  <Counter>{sessions.data?.items.length ?? 0}</Counter>
                </NavLink>
                <NavLink className="UnderlineNav-item" to={base + "/activity"}>
                  <Activity size={16} />
                  <span>Activity</span>
                </NavLink>
                <NavLink
                  className="UnderlineNav-item"
                  to={base + "/checkpoints"}
                >
                  <GitCommitHorizontal size={16} />
                  <span>Checkpoints</span>
                </NavLink>
                <NavLink className="UnderlineNav-item" to={base + "/settings"}>
                  <Settings size={16} />
                  <span>Settings</span>
                </NavLink>
              </nav>
            </div>
          </div>
          <main className="page">
            {demo ? (
              <div className="branchbar">
                {sourceFilter}
                <span className="branchbar-status">Demo history</span>
              </div>
            ) : (
              <RepositoryControls>{sourceFilter}</RepositoryControls>
            )}
            <Outlet
              key={window.location.search}
              context={
                {
                  project: project.data,
                  workstreams: ws.data?.items ?? [],
                  sessions: sessions.data?.items ?? [],
                  branch,
                } satisfies Context
              }
            />
          </main>
        </>
      )}
    </Async>
  );
}
function WorkstreamRows({
  items,
  sessions,
}: {
  items: Workstream[];
  sessions: Session[];
}) {
  const { project } = useOutletContext<Context>();
  if (!items.length)
    return (
      <Blankslate title="No workstreams yet">
        Launch an agent with <code>orbit codex</code> to capture your first
        task.
      </Blankslate>
    );
  return (
    <>
      {items.map((w) => {
        const ss = sessions.filter((s) => s.workstreamId === w.id);
        const latest = ss.at(-1);
        return (
          <Link
            className="Box-row"
            key={w.id}
            to={"/projects/" + project.id + "/workstreams/" + w.id}
          >
            <CircleDot
              size={16}
              className={
                "row-icon" + (latest?.status === "active" ? " green" : "")
              }
            />
            <div className="row-main">
              <span className="row-title">{w.title}</span>
              <span className="row-meta">
                <GitBranch size={12} />
                {w.branch ?? "no branch"}
                <span>·</span>
                {ss.length} sessions
                <span>·</span>
                <span className="mono">{w.id.slice(0, 12)}</span>
              </span>
            </div>
            <div className="row-aside">
              <div className="agent-stack">
                {[...new Set(ss.map((s) => s.agent))].map((a) => (
                  <Agent key={a} name={a} />
                ))}
              </div>
              <span>{age(w.updatedAt)}</span>
            </div>
          </Link>
        );
      })}
    </>
  );
}
function Overview() {
  const { project, workstreams, sessions, branch } =
    useOutletContext<Context>();
  const checkpoints = useApi<Page<Checkpoint>>(
    "/projects/" + project.id + "/checkpoints",
  );
  const latest = checkpoints.data?.items[0];
  const latestWorkstream = workstreams
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .find((w) => branch === "all" || w.branch === branch);
  const filtered = workstreams.filter(
    (w) => branch === "all" || w.branch === branch,
  );
  return (
    <div className="columns repository-overview">
      <section className="repository-main">
        {latestWorkstream && sessions.length > 0 && (
          <div className="resume-work">
            <div>
              <span className="resume-work-label">CONTINUE WORKING</span>
              <Link
                to={
                  "/projects/" +
                  project.id +
                  "/workstreams/" +
                  latestWorkstream.id
                }
              >
                {latestWorkstream.title}
              </Link>
              <p>
                Updated {age(latestWorkstream.updatedAt)}
                {latestWorkstream.branch
                  ? " on " + latestWorkstream.branch
                  : ""}
              </p>
            </div>
            <Continue workstream={latestWorkstream} />
          </div>
        )}
        <div className="Box">
          <div className="repository-latest">
            <span className="commit-avatar">
              <GitCommitHorizontal size={16} />
            </span>
            <div className="commit-summary">
              <strong>{latest?.author ?? project.owner}</strong>
              <span>
                {latest?.message ??
                  (checkpoints.isLoading
                    ? "Loading latest checkpoint..."
                    : "No checkpoints yet")}
              </span>
            </div>
            {latest?.oid && (
              <Link
                className="commit-hash"
                to={"/projects/" + project.id + "?revision=" + latest.oid}
              >
                {latest.oid.slice(0, 7)}
              </Link>
            )}
            <Link className="commit-history" to="checkpoints">
              <Clock3 size={15} />
              <span>
                {latest?.createdAt ? age(latest.createdAt) : "History"}
              </span>
            </Link>
          </div>
          {checkpoints.error && (
            <p className="repository-inline-error" role="alert">
              Could not load the latest checkpoint: {checkpoints.error.message}
            </p>
          )}
          <div className="Box-header">
            <h3 className="Box-title">
              <GitBranch size={16} />
              Workstreams
              <Counter>{filtered.length}</Counter>
            </h3>
            <Link className="Box-header-action" to="workstreams">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          {filtered.length ? (
            <WorkstreamRows
              items={filtered
                .slice()
                .sort(
                  (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
                )
                .slice(0, 6)}
              sessions={sessions}
            />
          ) : (
            <div className="repository-empty">
              <MessageSquare size={22} />
              <div>
                <strong>
                  {workstreams.length
                    ? "No workstreams on this source branch"
                    : "Your first conversation starts in the terminal"}
                </strong>
                <p>
                  {workstreams.length
                    ? "Choose another source branch to see its workstreams."
                    : "Launch an agent below. Its conversation and checkpoints will appear here."}
                </p>
              </div>
            </div>
          )}
        </div>
        {!sessions.length ? (
          <LaunchFlow project={project} sessions={sessions} />
        ) : (
          <details className="Box project-guide">
            <summary>
              <Terminal size={16} />
              <span>Capture another session</span>
              <ChevronDown size={16} />
            </summary>
            <LaunchFlow project={project} sessions={sessions} compact />
          </details>
        )}
      </section>
      <aside className="sidebar">
        <div className="sidebar-section">
          <div className="sidebar-heading">
            <h3>About</h3>
            <Link to="settings" aria-label="Project information">
              <Settings size={16} />
            </Link>
          </div>
          <p>
            {project.description || (
              <span className="empty-description">
                Agent conversation history for this project.
              </span>
            )}
          </p>
          {project.repository && (
            <div className="sidebar-list">
              <span>
                <FolderGit2 size={16} />
                {project.repository}
              </span>
            </div>
          )}
        </div>
        <div className="sidebar-section">
          <div className="sidebar-list">
            <Link to="workstreams">
              <GitBranch size={16} />
              <b>{workstreams.length}</b> workstreams
            </Link>
            <Link to="sessions">
              <MessageSquare size={16} />
              <b>{sessions.length}</b> sessions
            </Link>
            <span>
              <LockKeyhole size={16} />
              Stored on this computer
            </span>
          </div>
        </div>
        <div className="sidebar-section">
          <h3>Agents</h3>
          <div className="sidebar-list">
            {[...new Set(sessions.map((s) => s.agent))].map((name) => (
              <span key={name}>
                <Agent name={name} />
                {agentName(name)}
                <b className="count">
                  {sessions.filter((s) => s.agent === name).length}
                </b>
              </span>
            ))}
            {!sessions.length && (
              <p className="small muted">No agent sessions captured yet.</p>
            )}
          </div>
        </div>
        <div className="sidebar-section">
          <h3>History storage</h3>
          <p className="small">
            {project.cloudSyncEnabled
              ? "Local history for this project."
              : "Saved locally. The dashboard updates automatically."}
          </p>
          <Link className="small" to="settings">
            Manage project <ArrowRight size={12} />
          </Link>
        </div>
      </aside>
    </div>
  );
}
function Workstreams() {
  const { workstreams, sessions, branch } = useOutletContext<Context>();
  const [search, setSearch] = useState("");
  const items = workstreams
    .filter(
      (w) =>
        (branch === "all" || w.branch === branch) &&
        w.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return (
    <>
      <div className="Subhead">
        <h2 className="Subhead-heading">Workstreams</h2>
        <div className="Subhead-actions">
          <Modal
            title="Start a workstream"
            trigger={
              <button className="btn">
                <Plus size={14} />
                New workstream
              </button>
            }
          >
            <p>Create a workstream from your project directory.</p>
            <Command text={'orbit new "Describe your task"'} />
            <Command text="orbit codex" />
          </Modal>
        </div>
      </div>
      <div className="listing-toolbar">
        <div className="FormControl-search FormControl-search--full">
          <Search size={14} />
          <input
            aria-label="Find workstream"
            placeholder="Find a workstream…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="listing-count">{items.length} workstreams</span>
      </div>
      <div className="Box">
        <WorkstreamRows sessions={sessions} items={items} />
      </div>
    </>
  );
}
function SessionRows({ items }: { items: Session[] }) {
  const { project, workstreams } = useOutletContext<Context>();
  const lastActivity = (session: Session) =>
    session.endedAt ??
    workstreams.find((workstream) => workstream.id === session.workstreamId)
      ?.updatedAt ??
    session.startedAt;
  if (!items.length)
    return (
      <Blankslate title="No sessions yet">
        Launch Codex or Claude through Orbit to capture a session.
      </Blankslate>
    );
  return (
    <>
      {items
        .slice()
        .sort(
          (a, b) => Date.parse(lastActivity(b)) - Date.parse(lastActivity(a)),
        )
        .map((s) => (
          <Link
            className="Box-row"
            key={s.id}
            to={"/projects/" + project.id + "/sessions/" + s.id}
          >
            <Agent name={s.agent} />
            <div className="row-main">
              <span className="row-title">
                {workstreams.find((w) => w.id === s.workstreamId)?.title ??
                  agentName(s.agent) + " session"}
              </span>
              <span className="row-meta">
                <span>{agentName(s.agent)}</span>
                <span>·</span>
                Updated {age(lastActivity(s))}
              </span>
            </div>
            <div className="row-aside">
              <SessionState status={s.status} />
            </div>
          </Link>
        ))}
    </>
  );
}
function Sessions() {
  const { sessions, workstreams, branch } = useOutletContext<Context>();
  const [agent, setAgent] = useState("all");
  const items = sessions.filter(
    (s) =>
      (agent === "all" || s.agent === agent) &&
      (branch === "all" ||
        workstreams.find((w) => w.id === s.workstreamId)?.branch === branch),
  );
  return (
    <>
      <div className="Subhead">
        <h2 className="Subhead-heading">Sessions</h2>
        <span className="small muted">Latest activity first</span>
        <div className="Subhead-actions">
          <select
            aria-label="Filter agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="all">All agents</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </div>
      </div>
      <div className="Box">
        <SessionRows items={items} />
      </div>
    </>
  );
}

function WorkstreamDetail() {
  const { workstreamId } = useParams();
  const { project, workstreams, sessions } = useOutletContext<Context>();
  const w = workstreams.find((item) => item.id === workstreamId);
  if (!w) return <Blankslate title="Workstream not found" />;
  const own = sessions.filter((session) => session.workstreamId === w.id);
  return (
    <>
      <div className="PageHeader">
        <div>
          <Link
            className="PageHeader-parent"
            to={"/projects/" + project.id + "/workstreams"}
          >
            Workstreams
          </Link>
          <h1 className="PageHeader-title">{w.title}</h1>
          <div className="PageHeader-meta">
            <GitBranch size={12} />
            {w.branch ?? "no source branch"}
            <span>{own.length} sessions</span>
          </div>
        </div>
        <Continue workstream={w} />
      </div>
      <div className="Box">
        <div className="Box-header">
          <h3 className="Box-title">
            <Clock3 size={16} />
            Session history
          </h3>
          <Counter>{own.length}</Counter>
        </div>
        <SessionRows items={own} />
      </div>
    </>
  );
}
function EventView({
  event,
  agent,
}: {
  event: UniversalEvent;
  agent?: string;
}) {
  const p = event.payload;
  const body =
    "text" in p
      ? p.text
      : "output" in p
        ? p.output
        : "command" in p
          ? p.command
          : JSON.stringify(p, null, 2);
  const message = p.type === "user_message" || p.type === "assistant_message";
  return (
    <article
      className={"event " + (p.type === "user_message" ? "user-event" : "")}
      id={"event-" + event.id}
    >
      <div className="event-avatar">
        {p.type === "user_message" ? (
          "You"
        ) : message ? (
          agent ? (
            <Agent name={agent} />
          ) : (
            <OrbitMark size={22} />
          )
        ) : (
          <Terminal size={14} />
        )}
      </div>
      <div className="event-body">
        {message ? (
          <>
            <div className="event-heading">
              <strong>
                {p.type === "user_message"
                  ? "You"
                  : agent
                    ? agentName(agent)
                    : "Assistant"}
              </strong>
              <a href={"#event-" + event.id}>
                {new Date(event.occurredAt).toLocaleTimeString()}
              </a>
              {event.phase && event.phase !== "unknown" && (
                <span className="Label">{event.phase}</span>
              )}
              <span className="event-seq">#{event.sequence}</span>
            </div>
            <div className="markdown">
              <Suspense fallback={<pre>{body}</pre>}>
                <Markdown>{body}</Markdown>
              </Suspense>
            </div>
            {p.content?.map((attachment, index) => (
              <p className="note" key={index}>
                {attachment.mediaType} attachment: {attachment.reference} (
                {attachment.availability})
              </p>
            ))}
          </>
        ) : (
          <details>
            <summary>
              {p.type === "tool_call"
                ? p.name
                : p.type === "tool_result"
                  ? p.failed
                    ? "Tool result: failed"
                    : "Tool result: " + (p.status ?? "unknown")
                  : p.type === "command"
                    ? p.command.slice(0, 100)
                    : p.type.replaceAll("_", " ")}
              <ChevronDown size={14} />
            </summary>
            <pre>{body}</pre>
          </details>
        )}
      </div>
    </article>
  );
}
function SessionTimelineSection({
  projectId,
  session,
  search,
  handoff,
}: {
  projectId: string;
  session: Session;
  search: string;
  handoff: boolean;
}) {
  const path = "/projects/" + projectId + "/sessions/" + session.id + "/events";
  const q = useInfiniteQuery({
    queryKey: [revisionPath(path)],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      request<Page<UniversalEvent>>(
        path + (pageParam ? "?cursor=" + encodeURIComponent(pageParam) : ""),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 2000,
  });
  const events = [
    ...new Map(
      (
        q.data?.pages
          .slice()
          .reverse()
          .flatMap((p) => p.items) ?? []
      ).map((event) => [event.id, event]),
    ).values(),
  ];
  const visible = events.filter((event) =>
    JSON.stringify(event.payload).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="session-chain-section">
      <div
        className={"agent-handoff" + (handoff ? " agent-handoff--switch" : "")}
      >
        <Agent name={session.agent} large />
        <div>
          <strong>
            {agentName(session.agent)} {handoff ? "continued" : "started"} this
            conversation
          </strong>
          <span>
            {new Date(session.startedAt).toLocaleString()} · {session.status}
          </span>
        </div>
        <Link to={"/projects/" + projectId + "/sessions/" + session.id}>
          Session details
        </Link>
      </div>
      <Async loading={q.isLoading} error={q.error}>
        <div className="transcript">
          {visible.map((event) => (
            <EventView key={event.id} event={event} agent={session.agent} />
          ))}
          {!events.length && (
            <Blankslate title="Waiting for captured events">
              Captured events appear here automatically as your agent works.
            </Blankslate>
          )}
        </div>
        {q.hasNextPage && (
          <button
            className="btn session-load-more"
            disabled={q.isFetchingNextPage}
            onClick={() => q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? "Loading…" : "Load earlier events"}
          </button>
        )}
      </Async>
    </section>
  );
}
function SessionDetail() {
  const { sessionId } = useParams();
  const { project, sessions, workstreams } = useOutletContext<Context>();
  const s = sessions.find((x) => x.id === sessionId);
  const [search, setSearch] = useState("");
  const w = workstreams.find((w) => w.id === s?.workstreamId);
  if (!s) return <Blankslate title="Session not found" />;
  const chain: Session[] = [],
    seen = new Set<string>();
  let current: Session | undefined = s;
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.continuation
      ? sessions.find(
          (item) =>
            item.id === current!.continuation!.sessionId &&
            item.workstreamId === s.workstreamId,
        )
      : undefined;
  }
  return (
    <>
      <div className="PageHeader">
        <div>
          {w && (
            <Link
              className="PageHeader-parent"
              to={"/projects/" + project.id + "/workstreams/" + s.workstreamId}
            >
              {w.title}
            </Link>
          )}
          <h1 className="PageHeader-title">
            <Agent name={s.agent} large />
            {agentName(s.agent)} {chain.length > 1 ? "continuation" : "session"}
          </h1>
          <div className="PageHeader-meta">
            <SessionState status={s.status} />
            <span className="mono">{s.id}</span>
            <span>·</span>
            Started {new Date(s.startedAt).toLocaleString()}
            {chain.length > 1 && (
              <>
                <span>·</span>
                Continued from {agentName(chain[chain.length - 2]!.agent)}
              </>
            )}
          </div>
        </div>
        {w && <Continue workstream={w} />}
      </div>
      <div className="listing-toolbar">
        <div className="FormControl-search">
          <Search size={14} />
          <input
            aria-label="Search loaded conversation"
            placeholder="Search loaded conversation…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="listing-count">
          {chain.length} connected {chain.length === 1 ? "session" : "sessions"}
        </span>
      </div>
      <div className="session-chain">
        {chain.map((item, index) => (
          <SessionTimelineSection
            key={item.id}
            projectId={project.id}
            session={item}
            search={search}
            handoff={index > 0}
          />
        ))}
      </div>
    </>
  );
}
function ActivityPage() {
  const { sessions, workstreams, project, branch } =
    useOutletContext<Context>();
  const items = sessions
    .filter(
      (s) =>
        branch === "all" ||
        workstreams.find((w) => w.id === s.workstreamId)?.branch === branch,
    )
    .slice()
    .reverse();
  return (
    <>
      <div className="Subhead">
        <h2 className="Subhead-heading">Activity</h2>
      </div>
      {items.length ? (
        <div className="timeline">
          {items.map((s) => (
            <div className="timeline-item" key={s.id}>
              <span className="timeline-badge">
                <Agent name={s.agent} />
              </span>
              <div className="timeline-body">
                <p>
                  <Link to={"/projects/" + project.id + "/sessions/" + s.id}>
                    {agentName(s.agent)} session
                  </Link>{" "}
                  <span className="muted">
                    {s.status === "active" ? "started" : s.status}
                  </span>
                </p>
                <span className="row-meta">
                  {workstreams.find((w) => w.id === s.workstreamId)?.title}
                  <span>·</span>
                  {age(s.endedAt ?? s.startedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Blankslate title="No activity yet" />
      )}
    </>
  );
}
function ProjectSettings() {
  const { project } = useOutletContext<Context>();
  return (
    <section className="page--narrow">
      <div className="Subhead">
        <h2 className="Subhead-heading">Local project</h2>
      </div>
      <p>
        History is read directly from this project's <code>.orbit/</code>{" "}
        directory.
      </p>
      <div className="Box local-quickstart">
        <h3>Capture</h3>
        <Command text="orbit claude" />
        <Command text="orbit codex" />
        <h3>Import existing sessions</h3>
        <Command text="orbit import" />
      </div>
      <h3>Excluded file patterns</h3>
      <p className="small muted">
        These patterns apply to capture. Earlier checkpoints retain their
        recorded history.
      </p>
      <pre>{project.excludedPaths.join("\n")}</pre>
      <h3>Dashboard service</h3>
      <Command text="orbit dashboard --stop" />
      <Command text="orbit dashboard" />
    </section>
  );
}
function Onboarding() {
  return (
    <main className="page page--narrow">
      <div className="Subhead">
        <div>
          <h1 className="Subhead-heading">
            Your conversation, carried forward.
          </h1>
          <p className="workspace-description">
            Start with the project you are working on.
          </p>
        </div>
      </div>
      <LaunchFlow />
      <p className="note">
        Orbit captures sessions you launch through it and transcripts you choose
        to import. Keep this page open to see new activity.
      </p>
    </main>
  );
}
function SearchPage() {
  const { project } = useOutletContext<Context>();
  const [text, setText] = useState(""),
    [query, setQuery] = useState("");
  const path =
    "/projects/" + project.id + "/search?q=" + encodeURIComponent(query);
  const q = useInfiniteQuery({
    queryKey: [revisionPath(path)],
    enabled: Boolean(query),
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      request<
        Page<{
          id: string;
          sessionId: string;
          title: string;
          agent: string;
          snippet: string;
          occurredAt: string;
        }>
      >(path + (pageParam ? "&cursor=" + encodeURIComponent(pageParam) : "")),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <section>
      <div className="Subhead">
        <h1 className="Subhead-heading">Search history</h1>
      </div>
      <form
        className="listing-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(text.trim());
        }}
      >
        <div className="FormControl-search FormControl-search--full">
          <Search size={14} />
          <input
            aria-label="Search project history"
            placeholder="Find a decision, prompt, or tool output..."
            maxLength={200}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" disabled={!text.trim()}>
          Search
        </button>
      </form>
      <Async loading={q.isFetching && !q.data} error={q.error}>
        <div className="Box">
          {q.data?.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <Link
                key={item.id}
                className="Box-row local-search-result"
                to={"/projects/" + project.id + "/sessions/" + item.sessionId}
              >
                <Agent name={item.agent} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.snippet}</p>
                  <span className="small muted">{age(item.occurredAt)}</span>
                </div>
              </Link>
            ))}
        </div>
      </Async>
      {query && q.data && !q.data.pages[0]?.items.length && (
        <Blankslate title="No matching history">Try another phrase.</Blankslate>
      )}
      {q.hasNextPage && (
        <button
          className="btn"
          onClick={() => q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          More results
        </button>
      )}
    </section>
  );
}
export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route
          path="/workspace"
          element={<Navigate to="/projects" replace />}
        />
        <Route path="/projects" element={<Dashboard />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Overview />} />
          <Route path="workstreams" element={<Workstreams />} />
          <Route
            path="workstreams/:workstreamId"
            element={<WorkstreamDetail />}
          />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:sessionId" element={<SessionDetail />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="memory" element={<SearchPage />} />
          <Route path="checkpoints" element={<CheckpointsPage />} />
          <Route path="settings" element={<ProjectSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
  );
}
