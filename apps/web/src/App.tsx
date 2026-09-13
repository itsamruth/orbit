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
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
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
  LogOut,
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
  Account,
  Project,
  Session,
  Workstream,
  UniversalEvent,
  Page,
  Device,
  Checkpoint,
} from "@orbit/contracts";
import { ApiError, request, useApi, useWrite, useCollection } from "./api";

import {
  RepositoryControls,
  CheckpointsPage,
  AllConversations,
  LinkEmail,
} from "./RepositoryViews";
import { revisionPath } from "./api";
import { GettingStartedPage, LaunchFlow } from "./LaunchFlow";
import { AuthPage, HostedSetup, useAuthConfig } from "./HostedFlow";
import Landing from "./Landing";
import MemoryPage from "./MemoryPage";
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
const demo = import.meta.env.MODE === "demo";
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
function Agent({ name, large }: { name: string; large?: boolean }) {
  return (
    <span
      className={"agent " + name + (large ? " agent--lg" : "")}
      title={agentName(name)}
      aria-hidden="true"
    >
      {agentMark(name)}
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
function Setup() {
  const config = useAuthConfig();
  if (config.isLoading) return <p role="status">Loading setup...</p>;
  if (config.error) return <p role="alert">{config.error.message}</p>;
  return config.data?.mode === "hosted" ? <HostedSetup compact /> : <LaunchFlow compact />;
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
  const me = useApi<Account>("/me");
  const [theme, setTheme] = useState(
    localStorage.getItem("orbit-theme") ?? "light",
  );
  const write = useWrite();
  if (me.error instanceof ApiError && me.error.status === 401)
    return (
      <Navigate
        to={
          "/login?next=" +
          encodeURIComponent(location.pathname + location.search)
        }
        replace
      />
    );
  return (
    <Async loading={me.isLoading} error={me.error}>
      <div className="app">
        <header className="AppHeader">
          <div className="AppHeader-inner">
            <Link className="AppHeader-logo" to="/projects">
              <OrbitMark size={34} title="Orbit" />
              <span>Orbit</span>
            </Link>
            <nav className="AppHeader-nav" aria-label="Global">
              <Link to="/projects">Projects</Link>
              <Link to="/onboarding">Getting started</Link>
            </nav>
            <div className="AppHeader-actions">
              {demo && (
                <span className="AppHeader-flag">Demo · sample data</span>
              )}
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
              <Link
                className="avatar"
                aria-label="Account settings"
                to="/account"
              >
                {me.data?.login.slice(0, 2).toUpperCase()}
              </Link>
            </div>
          </div>
        </header>
        <Outlet context={me.data} />
        <footer className="footer">
          <div className="footer-inner">
            <OrbitMark size={27} />
            <span>© {new Date().getFullYear()} Orbit</span>
            <nav className="footer-nav">
              <Link to="/onboarding">Quickstart</Link>
              <Link to="/account">Account</Link>
              <button
                className="btn-link"
                onClick={() =>
                  write.mutate(
                    { path: "/auth/logout", method: "POST" },
                    { onSuccess: () => window.location.assign("/login") },
                  )
                }
              >
                Sign out
              </button>
            </nav>
          </div>
        </footer>
      </div>
    </Async>
  );
}
function Login() {
  return <AuthPage />;
}
function Dashboard() {
  const q = useCollection<Project>("/projects");
  const account = useOutletContext<Account>();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated");
  const [visibility, setVisibility] = useState("all");
  const items =
    q.data?.items.filter((p) =>
      (p.name + " " + p.description)
        .toLowerCase()
        .includes(search.toLowerCase()),
    ).filter((p) => visibility === "all" || (visibility === "published" ? p.cloudSyncEnabled : !p.cloudSyncEnabled))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) ?? [];
  return (
    <main className="page workspace-page">
      <aside className="workspace-nav" aria-label="Workspace">
        <div className="workspace-identity">
          <span className="workspace-avatar"><OrbitMark size={34} /></span>
          <div><strong>{account?.login ?? "Your workspace"}</strong><span>Personal workspace</span></div>
        </div>
        <nav>
          <Link to="/projects" className="workspace-nav-item selected" aria-current="page"><FolderGit2 size={16} />Projects<Counter>{q.data?.items.length ?? 0}</Counter></Link>
          <Link to="/onboarding" className="workspace-nav-item"><BookOpen size={16} />Quickstart</Link>
          <Link to="/account" className="workspace-nav-item"><Settings size={16} />Account settings</Link>
        </nav>
        <div className="workspace-note"><LockKeyhole size={16} /><p>Your projects are private.<br />Publishing is controlled per project.</p></div>
      </aside>
      <section className="workspace-content">
      <div className="Subhead">
        <div><span className="workspace-eyebrow">YOUR WORKSPACE</span><h1 className="Subhead-heading">Projects</h1><p className="workspace-description">Your repositories and their agent conversation history.</p></div>
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
            placeholder="Find a project…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select aria-label="Filter publishing status" value={visibility} onChange={(e) => setVisibility(e.target.value)}><option value="all">All projects</option><option value="local">Local only</option><option value="published">Publishing enabled</option></select>
        <select aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">Recently updated</option><option value="name">Name</option></select>
      </div>
      <Async loading={q.isLoading} error={q.error}>
        <div className="project-directory">
        <div className="directory-heading"><span><FolderGit2 size={16} />{items.length} {items.length === 1 ? "project" : "projects"}</span><span>Last updated</span></div>
        <ul className="repo-list">
          {items.map((p) => (
            <li className="repo-item" key={p.id}>
              <div className="repo-item-main">
                <div className="repo-item-title">
                  <BookOpen size={17} className="muted" />
                  <Link to={"/projects/" + p.id}>
                    <h2>{p.name}</h2>
                  </Link>
                  <Label>Private</Label>
                </div>
                <p className="repo-item-description">{p.description || "No description yet."}</p>
                <div className="repo-item-meta">
                  <span>
                    <span
                      className={"dot" + (p.cloudSyncEnabled ? " dot--on" : "")}
                    />
                    {p.cloudSyncEnabled ? "Publishing enabled" : "Local only"}
                  </span>
                  {p.repository && (
                    <span>
                      <FolderGit2 size={12} />
                      {p.repository}
                    </span>
                  )}
                </div>
              </div>
              <div className="project-row-end"><time dateTime={p.updatedAt} title={new Date(p.updatedAt).toLocaleString()}>{age(p.updatedAt)}</time><Link className="btn btn-sm" to={"/projects/" + p.id}>Open project<ArrowRight size={14} /></Link></div>
            </li>
          ))}
        </ul>
        {q.data?.items.length === 0 && (
          <Blankslate title="No projects yet">
            Run <code>orbit init</code> inside a project directory to start
            capturing agent conversations.
          </Blankslate>
        )}
        {q.data?.items.length !== 0 && !items.length && (
          <Blankslate title="No matching projects">
            Try a different search or publishing filter.
          </Blankslate>
        )}
        </div>
      </Async>
      <div className="workspace-start"><Terminal size={20} /><div><strong>{q.data?.items.length ? "Bring another repository into Orbit" : "Start with your first repository"}</strong><p>Initialize your project, launch your agent, and keep the conversation.</p></div><Link className="btn" to="/onboarding?new=1">Set up a project<ArrowRight size={14} /></Link></div>
      <p className="workspace-help"><BookOpen size={14} /><Link to="/onboarding">Read the quickstart</Link><span>for capture, checkpoints, and continuing work.</span></p>
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
                  <LockKeyhole size={11} />
                  Private
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
                      ? "Publishing enabled"
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
  const checkpoints = useApi<Page<Checkpoint>>("/projects/" + project.id + "/checkpoints");
  const latest = checkpoints.data?.items[0];
  const latestWorkstream = workstreams.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).find((w) => branch === "all" || w.branch === branch);
  const filtered = workstreams.filter(
    (w) => branch === "all" || w.branch === branch,
  );
  return (
    <div className="columns repository-overview">
      <section className="repository-main">
        {latestWorkstream && sessions.length > 0 && <div className="resume-work"><div><span className="resume-work-label">CONTINUE WORKING</span><Link to={"/projects/" + project.id + "/workstreams/" + latestWorkstream.id}>{latestWorkstream.title}</Link><p>Updated {age(latestWorkstream.updatedAt)}{latestWorkstream.branch ? " on " + latestWorkstream.branch : ""}</p></div><Continue workstream={latestWorkstream} /></div>}
        <div className="Box">
          <div className="repository-latest">
            <span className="commit-avatar"><GitCommitHorizontal size={16} /></span>
            <div className="commit-summary"><strong>{latest?.author ?? project.owner}</strong><span>{latest?.message ?? (checkpoints.isLoading ? "Loading latest checkpoint..." : "No checkpoints yet")}</span></div>
            {latest?.oid && <Link className="commit-hash" to={"/projects/" + project.id + "?revision=" + latest.oid}>{latest.oid.slice(0, 7)}</Link>}
            <Link className="commit-history" to="checkpoints"><Clock3 size={15} /><span>{latest?.createdAt ? age(latest.createdAt) : "History"}</span></Link>
          </div>
          {checkpoints.error && <p className="repository-inline-error" role="alert">Could not load the latest checkpoint: {checkpoints.error.message}</p>}
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
          {filtered.length ? <WorkstreamRows
            items={filtered
              .slice()
              .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
              .slice(0, 6)}
            sessions={sessions}
          /> : <div className="repository-empty"><MessageSquare size={22} /><div><strong>{workstreams.length ? "No workstreams on this source branch" : "Your first conversation starts in the terminal"}</strong><p>{workstreams.length ? "Choose another source branch to see its workstreams." : "Launch an agent below. Its conversation and checkpoints will appear here."}</p></div></div>}
        </div>
        {!sessions.length ? <LaunchFlow project={project} sessions={sessions} /> : <details className="Box project-guide"><summary><Terminal size={16} /><span>Capture another session</span><ChevronDown size={16} /></summary><LaunchFlow project={project} sessions={sessions} compact /></details>}
        {!demo && !revisionParam() && <details className="Box project-guide"><summary><MessageSquare size={16} /><span>Conversations across all branches</span><ChevronDown size={16} /></summary><div className="all-branches-content"><AllConversations /></div></details>}
      </section>
      <aside className="sidebar">
        <div className="sidebar-section">
          <div className="sidebar-heading"><h3>About</h3><Link to="settings" aria-label="Edit project details"><Settings size={16} /></Link></div>
          <p>
            {project.description || <span className="empty-description">No description yet. <Link to="settings">Add one</Link> to give this project some context.</span>}
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
              Private to you
            </span>
          </div>
        </div>
        <div className="sidebar-section">
          <h3>Agents</h3>
          <div className="sidebar-list">
            {[...new Set(sessions.map((s) => s.agent))].map((name) => <span key={name}><Agent name={name} />{agentName(name)}<b className="count">{sessions.filter((s) => s.agent === name).length}</b></span>)}
            {!sessions.length && <p className="small muted">No agent sessions captured yet.</p>}
          </div>
        </div>
        <div className="sidebar-section"><h3>History storage</h3><p className="small">{project.cloudSyncEnabled ? "Publishing enabled for this project." : "Local history. Publishing is disabled."}</p><Link className="small" to="settings">Manage project <ArrowRight size={12} /></Link></div>
      </aside>
    </div>
  );
}
function Workstreams() {
  const { workstreams, sessions, branch } = useOutletContext<Context>();
  const [search, setSearch] = useState("");
  const items = workstreams.filter(
    (w) =>
      (branch === "all" || w.branch === branch) &&
      w.title.toLowerCase().includes(search.toLowerCase()),
  ).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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
  const lastActivity = (session: Session) => session.endedAt ??
    workstreams.find((workstream) => workstream.id === session.workstreamId)?.updatedAt ?? session.startedAt;
  if (!items.length)
    return (
      <Blankslate title="No sessions yet">
        Launch Codex or Claude through Orbit to capture a session.
      </Blankslate>
    );
  return (
    <>
      {items.slice().sort((a, b) => Date.parse(lastActivity(b)) - Date.parse(lastActivity(a))).map((s) => (
        <Link
          className="Box-row"
          key={s.id}
          to={"/projects/" + project.id + "/sessions/" + s.id}
        >
          <Agent name={s.agent} />
          <div className="row-main">
            <span className="row-title">{workstreams.find((w) => w.id === s.workstreamId)?.title ?? agentName(s.agent) + " session"}</span>
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
function DeleteButton({
  path,
  label,
  onDone,
}: {
  path: string;
  label: string;
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const write = useWrite();
  if (revisionParam())
    return <span className="muted small">Historical revision · read only</span>;
  return (
    <Modal
      title={"Delete " + label}
      trigger={<button className="btn btn-danger">Delete {label}</button>}
    >
      <p>
        Removing a conversation affects the current branch. Earlier Git commits
        retain it. Deleting a hosted project removes that repository; other
        clones and backups remain.
      </p>
      <label className="FormControl">
        <span>Type DELETE to confirm</span>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button
        className="btn btn-danger btn-block"
        disabled={confirm !== "DELETE" || write.isPending}
        onClick={() =>
          write.mutate({ path, method: "DELETE" }, { onSuccess: onDone })
        }
      >
        {label === "project"
          ? "Delete hosted project"
          : "Remove " + label + " from this branch"}
      </button>
      {write.error && (
        <p role="alert" className="danger small">
          {write.error.message}
        </p>
      )}
    </Modal>
  );
}
function WorkstreamDetail() {
  const { workstreamId } = useParams();
  const { project, workstreams, sessions } = useOutletContext<Context>();
  const w = workstreams.find((x) => x.id === workstreamId);
  const write = useWrite();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  if (!w) return <Blankslate title="Workstream not found" />;
  const own = sessions.filter((s) => s.workstreamId === w.id);
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
            <span className="mono">{w.id}</span>
            <span>·</span>
            <GitBranch size={12} />
            {w.branch ?? "no branch"}
            <span>·</span>
            Created {new Date(w.createdAt).toLocaleDateString()}
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
      <div className="Subhead Subhead--bare">
        <Modal
          title="Rename workstream"
          trigger={
            <button className="btn" disabled={Boolean(revisionParam())}>
              Rename workstream
            </button>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              write.mutate({
                path: "/projects/" + project.id + "/workstreams/" + w.id,
                body: { title },
              });
            }}
          >
            <label className="FormControl">
              <span>Title</span>
              <input
                required
                maxLength={200}
                placeholder={w.title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary btn-block"
              disabled={write.isPending || !title.trim()}
            >
              Save title
            </button>
            {write.isSuccess && (
              <p role="status" className="green small">
                Title saved.
              </p>
            )}
            {write.error && (
              <p role="alert" className="danger small">
                {write.error.message}
              </p>
            )}
          </form>
        </Modal>
        <div className="Subhead-actions">
          <DeleteButton
            label="workstream"
            path={"/projects/" + project.id + "/workstreams/" + w.id}
            onDone={() => navigate("/projects/" + project.id + "/workstreams")}
          />
        </div>
      </div>
    </>
  );
}
function EventView({ event, agent }: { event: UniversalEvent; agent?: string }) {
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
          agent ? <Agent name={agent} /> : <OrbitMark size={22} />
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
              <span className="event-seq">#{event.sequence}</span>
            </div>
            <div className="markdown">
              <Suspense fallback={<pre>{body}</pre>}>
                <Markdown>{body}</Markdown>
              </Suspense>
            </div>
          </>
        ) : (
          <details>
            <summary>
              {p.type === "tool_call"
                ? p.name
                : p.type === "tool_result"
                  ? p.failed
                    ? "Failed tool result"
                    : "Tool result"
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
    refetchInterval: session.status === "active" ? 3000 : 10000,
  });
  const events = q.data?.pages.flatMap((p) => p.items) ?? [];
  const visible = events.filter((event) =>
    JSON.stringify(event.payload).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="session-chain-section">
      <div className={"agent-handoff" + (handoff ? " agent-handoff--switch" : "")}>
        <Agent name={session.agent} large />
        <div>
          <strong>
            {agentName(session.agent)} {handoff ? "continued" : "started"} this conversation
          </strong>
          <span>{new Date(session.startedAt).toLocaleString()} · {session.status}</span>
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
              History appears here after Orbit creates a checkpoint and publishes it.
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
  const navigate = useNavigate();
  const w = workstreams.find((w) => w.id === s?.workstreamId);
  if (!s) return <Blankslate title="Session not found" />;
  const chain = sessions
    .filter(
      (item) =>
        item.workstreamId === s.workstreamId &&
        Date.parse(item.startedAt) <= Date.parse(s.startedAt),
    )
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
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
      <div className="Subhead Subhead--bare session-actions">
        <div className="Subhead-actions">
          <DeleteButton
            label="session"
            path={"/projects/" + project.id + "/sessions/" + s.id}
            onDone={() => navigate("/projects/" + project.id + "/sessions")}
          />
        </div>
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
function ProjectSettingsForm({ project }: { project: Project }) {
  const [name, setName] = useState(project.name),
    [description, setDescription] = useState(project.description),
    [sync, setSync] = useState(project.cloudSyncEnabled),
    [paths, setPaths] = useState(project.excludedPaths.join("\n"));
  const write = useWrite();
  const navigate = useNavigate();
  return (
    <div className="page--narrow">
      <div className="Subhead">
        <h2 className="Subhead-heading">Project settings</h2>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          write.mutate({
            path: "/projects/" + project.id,
            body: {
              name,
              description,
              ...(demo ? { cloudSyncEnabled: sync } : {}),
              excludedPaths: paths
                .split("\n")
                .map((p) => p.trim())
                .filter(Boolean),
            },
          });
        }}
      >
        <label className="FormControl">
          <span>Project name</span>
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="FormControl">
          <span>Description</span>
          <textarea
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <hr />
        <h3>Capture and publishing</h3>
        <p className="small muted">
          Publishing is configured per checkout. Capture and checkpoints are
          automatic.
        </p>
        <Command text="orbit publish enable" />
        <Command text="orbit publish disable" />
        <label className="FormControl">
          <span>Excluded file patterns</span>
          <span className="FormControl-caption">
            One glob per line. Exclusions and automatic redaction apply to
            future capture; earlier Git commits retain previously captured
            content.
          </span>
          <textarea
            rows={5}
            aria-label="Excluded file patterns"
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={write.isPending}>
          {write.isPending ? "Saving…" : "Save changes"}
        </button>
        {write.isSuccess && (
          <p role="status" className="green small" style={{ marginTop: 12 }}>
            Changes saved.
          </p>
        )}
        {write.error && (
          <p
            role="alert"
            className="flash flash-error"
            style={{ marginTop: 12 }}
          >
            {write.error.message}
          </p>
        )}
      </form>
      <div className="Box danger-zone">
        <div className="Box-header">
          <h3 className="Box-title">Danger zone</h3>
        </div>
        <div className="danger-zone-row">
          <div>
            <strong>Delete this project</strong>
            <p>
              Removes the hosted repository. Other clones and backups remain
              independent copies.
            </p>
          </div>
          <DeleteButton
            label="project"
            path={"/projects/" + project.id}
            onDone={() => navigate("/projects")}
          />
        </div>
      </div>
    </div>
  );
}
function ProjectSettings() {
  const { project } = useOutletContext<Context>();
  if (revisionParam())
    return (
      <div className="note">
        <Info size={14} />
        <span>
          Historical settings are read only. Return to the latest revision to
          edit.
        </span>
      </div>
    );
  return <ProjectSettingsForm key={project.id} project={project} />;
}
function Onboarding() {
  const config = useAuthConfig();
  return <Async loading={config.isLoading} error={config.error}>{config.data && (config.data.mode === "hosted" ? <HostedSetup /> : <GettingStartedPage />)}</Async>;
}
function Home() {
  const projects = useCollection<Project>("/projects");
  return <Async loading={projects.isLoading} error={projects.error}>{projects.data && <Navigate to={projects.data.items.length ? "/projects" : "/onboarding?new=1"} replace />}</Async>;
}
function AccountPage() {
  const me = useOutletContext<Account>();
  const q = useApi<Page<Device>>("/devices");
  const write = useWrite();
  return (
    <main className="page page--narrow">
      <div className="Subhead">
        <h1 className="Subhead-heading">Account settings</h1>
      </div>
      <div className="profile">
        <span className="avatar avatar--lg">
          {me.login.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h3>{me.login}</h3>
          <span className="muted small">Orbit account</span>
        </div>
      </div>
      {!demo && <LinkEmail />}
      <div className="Subhead">
        <h2 className="Subhead-heading">Authorized devices</h2>
        <p className="Subhead-description">
          Revoke a device to stop its access to your hosted projects.
        </p>
      </div>
      <Async loading={q.isLoading} error={q.error}>
        <div className="Box">
          {q.data?.items.map((d) => (
            <div className="device-row" key={d.id}>
              <Laptop size={20} />
              <div>
                <strong>{d.name}</strong>
                <p>Last seen {age(d.lastSeenAt)}</p>
              </div>
              <button
                className="btn btn-danger btn-sm"
                disabled={write.isPending}
                onClick={() =>
                  write.mutate({ path: "/devices/" + d.id, method: "DELETE" })
                }
              >
                Revoke
              </button>
            </div>
          ))}
          {!q.data?.items.length && (
            <Blankslate title="No CLI devices connected">
              Run <code>orbit auth login</code> on your computer.
            </Blankslate>
          )}
        </div>
      </Async>
      {write.error && (
        <p role="alert" className="flash flash-error">
          {write.error.message}
        </p>
      )}
      <button
        className="btn"
        onClick={() =>
          write.mutate(
            { path: "/auth/logout", method: "POST" },
            { onSuccess: () => window.location.assign("/login") },
          )
        }
      >
        <LogOut size={14} />
        Sign out
      </button>
    </main>
  );
}
function DeviceApproval() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const write = useWrite();
  return (
    <main className="page page--narrow">
      <div className="Subhead">
        <h1 className="Subhead-heading">Connect your CLI</h1>
        <p className="Subhead-description">
          Only approve a code shown by an Orbit login you started on your own
          computer.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          write.mutate({
            path: "/auth/device/approve",
            method: "POST",
            body: { code },
          });
        }}
      >
        <label className="FormControl">
          <span>Device code</span>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <button
          className="btn btn-primary"
          disabled={write.isPending || write.isSuccess}
        >
          Approve device
        </button>
        {write.isSuccess && (
          <p role="status" className="green small" style={{ marginTop: 12 }}>
            Device approved. Return to your terminal to finish connecting.
            <Link className="btn" to="/onboarding">Continue setup <ArrowRight size={14} /></Link>
          </p>
        )}
        {write.error && (
          <p
            role="alert"
            className="flash flash-error"
            style={{ marginTop: 12 }}
          >
            {write.error.message}
          </p>
        )}
      </form>
    </main>
  );
}
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<AuthPage />} />
      <Route element={<Shell />}>
        <Route path="/workspace" element={<Home />} />
        <Route path="/projects" element={<Dashboard />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/device" element={<DeviceApproval />} />
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
          <Route path="memory" element={<MemoryPage />} />
          <Route path="checkpoints" element={<CheckpointsPage />} />
          <Route path="settings" element={<ProjectSettings />} />
        </Route>
        <Route
          path="*"
          element={
            <main className="page">
              <Blankslate title="Page not found">
                <Link to="/projects">Return to projects</Link>
              </Blankslate>
            </main>
          }
        />
      </Route>
    </Routes>
  );
}
