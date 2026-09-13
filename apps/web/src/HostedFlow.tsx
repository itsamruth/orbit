import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Github, Laptop, LockKeyhole, Mail, Terminal } from "lucide-react";
import type { Account, Device, Project } from "@orbit/contracts";
import { ApiError, request, useApi, useCollection } from "./api";
import { CopyLine } from "./LaunchFlow";
import { OrbitMark } from "./OrbitMark";

type AuthConfig = { mode: "local" | "hosted"; origin: string; email: boolean; github: boolean };
export const useAuthConfig = () => useApi<AuthConfig>("/auth/config");
function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/workspace";
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin && !["/", "/login", "/signup"].includes(url.pathname) ? url.pathname + url.search : "/workspace"; }
  catch { return "/workspace"; }
}

export function AuthPage() {
  const config = useAuthConfig();
  const me = useApi<Account>("/me");
  const [params] = useSearchParams();
  const location = useLocation();
  const signup = location.pathname === "/signup";
  const token = params.get("token");
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!token && me.data && config.data?.mode === "hosted") return <Navigate to={next} replace />;
  const providers = config.data;
  const githubNext = ["/workspace", "/projects", "/device", "/onboarding"].includes(next.split("?")[0]!) ? next : "/workspace";
  return <main className="auth-page">
    <header className="auth-header"><Link to="/" className="auth-brand"><OrbitMark size={34} title="Orbit" /><span>Orbit</span></Link><span>{signup ? "Already have an account?" : "New to Orbit?"}<Link to={(signup ? "/login" : "/signup") + "?next=" + encodeURIComponent(next)}>{signup ? "Sign in" : "Create an account"}<ArrowRight size={13} /></Link></span></header>
    <div className="auth-layout"><aside className="auth-story"><span className="first-run-eyebrow">YOUR WORK, WITH CONTEXT</span><h1>Pick up where<br />you left off.</h1><p>A private home for the conversations behind your code. Across sessions, machines, and agents.</p><ol><li><span>01</span>Create your account</li><li><span>02</span>Connect your terminal</li><li><span>03</span>Bring your projects with you</li></ol><div className="auth-privacy"><LockKeyhole size={16} /><span>You choose which projects to publish.<br />Your source code stays in its own repository.</span></div></aside>
      <section className="auth-form-panel">
        <div className="auth-form-icon">{sent ? <Mail size={24} /> : token ? <LockKeyhole size={24} /> : <OrbitMark size={36} />}</div>
        <h2>{sent ? "Check your inbox" : token ? "Finish signing in" : signup ? "Create your Orbit account" : "Welcome back"}</h2>
        <p className="auth-intro">{sent ? <>We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.</> : token ? "Confirm this link to open your private workspace." : signup ? "Start with your email. No password to remember." : "Sign in to your projects and conversation history."}</p>
        {config.isLoading && <p role="status" className="muted small">Loading sign-in options...</p>}
        {config.error && <div className="flash flash-error" role="alert">Could not load sign-in options.<button className="btn" onClick={() => void config.refetch()}>Retry</button></div>}
        {!config.error && !config.isLoading && !token && !sent && providers?.github && <><a className="btn auth-github" href={"/api/v1/auth/github?returnTo=" + encodeURIComponent(githubNext)}><Github size={18} />Continue with GitHub</a>{providers.email && <div className="auth-divider"><span>or use email</span></div>}</>}
        {!sent && (token || providers?.email || (providers && !providers.github)) && <form onSubmit={async (e) => {
          e.preventDefault(); setError(""); setBusy(true);
          try {
            if (token) { await request("/auth/email/confirm", { method: "POST", body: JSON.stringify({ token }) }); window.location.replace(next); }
            else { await request("/auth/email/request", { method: "POST", body: JSON.stringify({ email: email.trim(), next }) }); setEmail(email.trim()); setSent(true); }
          } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed. Please try again."); }
          finally { setBusy(false); }
        }}>
          {!token && <label className="FormControl"><span>Email address</span><input type="email" name="email" autoComplete="email" placeholder="you@example.com" required disabled={!providers?.email} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
          <button className="btn btn-primary btn-block" disabled={busy || (!token && !providers?.email)}>{busy ? "Please wait..." : token ? "Confirm and continue" : "Continue with email"}{!busy && <ArrowRight size={14} />}</button>
        </form>}
        {sent && <div className="auth-sent" role="status"><p>Open the link on this device to finish. If it isn't there, check your spam folder.</p><button className="btn" onClick={() => { setSent(false); setError(""); }}>Use another email or resend</button></div>}
        {error && <div className="auth-error" role="alert">{error}{token && <Link to={"/login?next=" + encodeURIComponent(next)}>Request a new sign-in link</Link>}</div>}
        {me.error && !(me.error instanceof ApiError && me.error.status === 401) && <p className="auth-error" role="alert">Your session could not be checked. Please try again.</p>}
        {providers && !providers.email && !providers.github && !token && <div className="auth-unconfigured" role="status"><strong>Sign-in isn't configured on this server yet.</strong><p>The server owner needs to enable email delivery or GitHub sign-in before accounts can be created.</p>{providers.mode === "local" && <Link className="btn" to="/projects">Open local workspace<ArrowRight size={14} /></Link>}</div>}
        {!sent && !token && providers?.email && <p className="auth-fineprint">Your first verified sign-in creates your account. Existing accounts sign in with the same email.</p>}
      </section>
    </div><footer className="auth-footer">Orbit<span>Private projects. Portable context.</span></footer>
  </main>;
}

export function HostedSetup({ compact = false }: { compact?: boolean }) {
  const config = useAuthConfig();
  const me = useApi<Account>("/me");
  const devices = useCollection<Device>("/devices");
  const projects = useCollection<Project>("/projects");
  const [shell, setShell] = useState("posix");
  const [agent, setAgent] = useState("codex");
  const connected = Boolean(devices.data?.items.length);
  const firstProject = projects.data?.items.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const error = config.error ?? me.error ?? devices.error ?? projects.error;
  const origin = config.data?.origin ?? window.location.origin;
  const quote = (s: string) => "'" + s.replaceAll("'", shell === "powershell" ? "''" : "'\\''") + "'";
  const exportCommand = shell === "powershell" ? "$env:ORBIT_SERVER_URL = " + quote(origin) : "export ORBIT_SERVER_URL=" + quote(origin);
  const steps = [true, connected, Boolean(firstProject)];
  const active = steps.findIndex((done) => !done);
  const body = <>
    {!compact && <div className="hosted-welcome"><span className="first-run-eyebrow">YOUR PERSONAL WORKSPACE</span><h1>{firstProject ? "You're connected." : "Your account is ready."}</h1><p>{firstProject ? "Open a project to explore its history or continue a conversation." : "Connect your terminal and bring your first project into Orbit."}</p></div>}
    {error ? <div className="flash flash-error" role="alert">{error.message}<button className="btn" onClick={() => { void config.refetch(); void me.refetch(); void devices.refetch(); void projects.refetch(); }}>Try again</button></div> : me.isLoading || devices.isLoading || projects.isLoading || config.isLoading ? <p className="loading" role="status">Checking your workspace...</p> : <section className="launch-flow hosted-checklist">
      <header className="launch-flow-heading"><Laptop size={17} /><span>Connect your workflow</span><span className="launch-step-count">{steps.filter(Boolean).length} of 3 complete</span></header>
      <ol className="launch-steps">
        <li><span className="launch-step-marker complete"><Check size={14} /></span><div className="launch-step-body"><h3>Account created</h3><p>Signed in as <strong>{me.data?.login}</strong>. Projects you publish belong to this account.</p></div></li>
        <li aria-current={active === 1 ? "step" : undefined}><span className={"launch-step-marker " + (connected ? "complete" : "current")}>{connected ? <Check size={14} /> : 2}</span><div className="launch-step-body"><h3>{connected ? "Terminal connected" : "Connect your terminal"}</h3>{connected ? <p>{devices.data?.items[0]?.name} is authorized. <Link to="/account">Manage devices</Link></p> : <p>Point the Orbit CLI at this workspace. Open the URL it prints and approve the matching device code.</p>}
          <label className="hosted-shell"><span>Terminal</span><select aria-label="Terminal shell" value={shell} onChange={(e) => setShell(e.target.value)}><option value="posix">macOS / Linux</option><option value="powershell">PowerShell</option></select></label><CopyLine command={exportCommand} /><CopyLine command="orbit auth login" />
          <details className="launch-install"><summary>Need to install the CLI?</summary><p>In the Orbit source checkout, run these once. Then return to your project directory.</p><CopyLine command="npm install" /><CopyLine command="npm run build" /><CopyLine command="npm link --workspace @orbit/cli" /></details>
          {!connected && <p className="launch-hint">This step completes after your terminal receives its credential. Copying the command doesn't connect it.</p>}
        </div></li>
        <li aria-current={active === 2 ? "step" : undefined}><span className={"launch-step-marker " + (firstProject ? "complete" : connected ? "current" : "")}>{firstProject ? <Check size={14} /> : 3}</span><div className="launch-step-body"><h3>{firstProject ? "Project connected" : "Publish your first project"}</h3>{firstProject ? <><p><strong>{firstProject.name}</strong> is in your workspace.</p><Link className="btn btn-primary" to={"/projects/" + firstProject.id}>Open project<ArrowRight size={14} /></Link></> : <><p>In your project directory, initialize its conversation history and choose to publish it to your account.</p><CopyLine command="orbit init" /><CopyLine command="orbit publish enable" /><CopyLine command="orbit push" /><p className="launch-hint">If this checkout already has a conversation Git remote, publishing keeps it. Choose this Orbit server as its remote before pushing here.</p><label className="hosted-shell"><span>Then capture with</span><select aria-label="Capture agent" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label><CopyLine command={"orbit " + agent} /><p className="launch-hint">Only projects you explicitly publish appear here. This page updates automatically.</p></>}
        </div></li>
      </ol><footer className="launch-flow-footer"><LockKeyhole size={14} /><span>Publishing uploads this project's conversation history to your private account.</span></footer>
    </section>}
    {!compact && <Link className="hosted-skip" to="/projects">{firstProject ? "See all projects" : "Explore my workspace first"}<ArrowRight size={14} /></Link>}
  </>;
  return compact ? body : <main className="page hosted-setup-page">{body}</main>;
}
