import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  LockKeyhole,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { OrbitMark } from "./OrbitMark";
import "./landing.css";

const questions = [
  {
    question: "Is Orbit another coding agent?",
    answer:
      "No. Orbit is the history layer around the coding agents you already use. It keeps their conversations connected to the code they produced.",
  },
  {
    question: "Does Orbit upload every conversation?",
    answer:
      "No. Sessions stay local by default. You decide which projects and conversations should be published to your Orbit workspace.",
  },
  {
    question: "How is this different from an agent's chat history?",
    answer:
      "Agent chats are usually isolated from the repository. Orbit gives conversations Git-backed checkpoints, project structure, and a durable place for teams to continue the work.",
  },
  {
    question: "Which coding agents are supported?",
    answer:
      "Orbit is designed for terminal-based agents, beginning with Codex and Claude Code, with a format that can support more tools over time.",
  },
];

export default function Landing() {
  const [openQuestion, setOpenQuestion] = useState<number | null>(0);

  return (
    <main className="orbit-landing-calm">
      <div className="calm-sky" aria-hidden="true" />

      <nav className="calm-nav" aria-label="Main navigation">
        <a className="calm-brand" href="#top" aria-label="Orbit home">
          <OrbitMark size={28} title="Orbit" />
          <span>orbit</span>
        </a>
        <div className="calm-nav-links">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#questions">Questions</a>
          <a
            href="https://github.com/ayghri/i-have-adhd"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
        <div className="calm-nav-actions">
          <Link to="/login">Log in</Link>
          <Link className="calm-button calm-button-dark calm-nav-signup" to="/signup?next=%2Fworkspace">
            Sign up
          </Link>
        </div>
      </nav>

      <section className="calm-hero" id="top">
        <div className="calm-hero-copy">
          <p className="calm-kicker"><span /> Open-source conversation history</p>
          <h1>
            Your AI wrote the code.
            <span>Orbit keeps the context.</span>
          </h1>
          <p className="calm-hero-description">
            Capture coding-agent conversations, connect them to Git, and
            continue the work without rebuilding the story from scratch.
          </p>
          <div className="calm-hero-actions">
            <Link className="calm-button calm-button-dark" to="/signup?next=%2Fworkspace">
              Create your account <ArrowRight size={15} />
            </Link>
            <a className="calm-button calm-button-light" href="#workflow">
              See how it works
            </a>
          </div>
          <p className="calm-hero-note">Local first. Publish only when you choose.</p>
        </div>

        <div className="calm-product-scene" aria-label="A recorded Orbit coding session">
          <div className="calm-product-card">
            <header className="calm-product-header">
              <div className="calm-product-project">
                <OrbitMark size={25} />
                <span>orbit / redirect-fix</span>
              </div>
              <span className="calm-recording"><i /> Session in progress</span>
            </header>

            <div className="calm-product-body">
              <div className="calm-product-title">
                <div>
                  <span>CODEX SESSION</span>
                  <h2>Fix the login redirect</h2>
                </div>
                <time>Today, 10:42</time>
              </div>

              <div className="calm-conversation">
                <article>
                  <div className="calm-avatar">Y</div>
                  <div>
                    <span>You</span>
                    <p>The callback loses the return path. Keep it through sign-in, then send the user back to their workspace.</p>
                  </div>
                </article>
                <article>
                  <div className="calm-avatar calm-avatar-agent"><MessageSquare size={15} /></div>
                  <div>
                    <span>Codex</span>
                    <p>I found the redirect being cleared before the auth exchange completes. I’ll preserve it in the callback state.</p>
                  </div>
                </article>
              </div>

              <div className="calm-command">
                <Terminal size={16} />
                <code>orbit checkpoint</code>
                <span><Check size={14} /> Conversation saved</span>
              </div>
            </div>

            <footer className="calm-product-footer">
              <span><GitBranch size={15} /> main</span>
              <span><GitCommitHorizontal size={15} /> 4c7a91d</span>
              <span>3 messages</span>
            </footer>
          </div>
        </div>
      </section>

      <section className="calm-features" id="features">
        <div className="calm-section-heading">
          <h2>Everything worth remembering, attached to the work.</h2>
          <p>
            Orbit turns a temporary agent chat into useful project history,
            without asking you to replace your editor, terminal, or Git workflow.
          </p>
        </div>

        <div className="calm-feature-grid">
          <article className="calm-feature-card calm-feature-wide">
            <div className="calm-feature-visual calm-capture-visual">
              <div className="calm-terminal-window">
                <div><i /><i /><i /></div>
                <code><span>$</span> orbit codex</code>
                <p>Recording session in <strong>orbit/web</strong></p>
                <p className="is-success"><Check size={13} /> Ready. Work normally.</p>
              </div>
            </div>
            <div className="calm-feature-copy">
              <h3>Capture without changing how you work.</h3>
              <p>Start your agent through Orbit. Prompts, responses, and tool calls are recorded quietly in the background.</p>
            </div>
          </article>

          <article className="calm-feature-card calm-feature-wide">
            <div className="calm-feature-visual calm-history-visual">
              <div className="calm-history-line" />
              <div className="calm-history-event">
                <span className="calm-history-dot"><MessageSquare size={13} /></span>
                <div><small>10:42</small><strong>Session started</strong><p>Fix the login redirect</p></div>
              </div>
              <div className="calm-history-event">
                <span className="calm-history-dot"><GitCommitHorizontal size={13} /></span>
                <div><small>10:51</small><strong>Checkpoint saved</strong><p>4c7a91d on main</p></div>
              </div>
            </div>
            <div className="calm-feature-copy">
              <h3>See the reasoning beside the commit.</h3>
              <p>Understand what changed, which constraints mattered, and how the agent arrived at the final implementation.</p>
            </div>
          </article>

          <article className="calm-feature-card calm-feature-third">
            <div className="calm-feature-visual calm-branch-visual">
              <GitBranch size={24} />
              <div>
                <span>main</span>
                <strong>redirect-fix</strong>
                <small>2 sessions</small>
              </div>
            </div>
            <div className="calm-feature-copy">
              <h3>Organized like Git</h3>
              <p>Projects, branches, sessions, and checkpoints stay naturally connected.</p>
            </div>
          </article>

          <article className="calm-feature-card calm-feature-third">
            <div className="calm-feature-visual calm-private-visual">
              <div className="calm-lock-ring"><LockKeyhole size={25} /></div>
              <p><strong>Private by default</strong><span>Nothing published</span></p>
            </div>
            <div className="calm-feature-copy">
              <h3>You control publishing</h3>
              <p>Keep experiments local and share only the project history your team needs.</p>
            </div>
          </article>

          <article className="calm-feature-card calm-feature-third">
            <div className="calm-feature-visual calm-continue-visual">
              <span>LAST SESSION</span>
              <p>Authentication callback repaired</p>
              <button>Continue here <ArrowRight size={13} /></button>
            </div>
            <div className="calm-feature-copy">
              <h3>Continue from anywhere</h3>
              <p>Resume on another machine or hand the thread to a teammate without writing a recap.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="calm-workflow" id="workflow">
        <div className="calm-workflow-heading">
          <p className="calm-label">THE ORBIT WORKFLOW</p>
          <h2>From prompt to permanent project history.</h2>
          <p>Three small actions keep every coding session useful long after the window closes.</p>
        </div>

        <div className="calm-workflow-steps">
          <article>
            <span>01</span>
            <div className="calm-workflow-icon"><Terminal size={20} /></div>
            <h3>Run your agent</h3>
            <p>Use <code>orbit codex</code> inside the repository you are already working in.</p>
          </article>
          <article>
            <span>02</span>
            <div className="calm-workflow-icon"><GitCommitHorizontal size={20} /></div>
            <h3>Save a checkpoint</h3>
            <p>Orbit ties the conversation and its decisions to a durable Git-backed moment.</p>
          </article>
          <article>
            <span>03</span>
            <div className="calm-workflow-icon"><ArrowRight size={20} /></div>
            <h3>Continue or publish</h3>
            <p>Resume with context intact, or publish selected history to your hosted workspace.</p>
          </article>
        </div>
      </section>

      <section className="calm-principle">
        <div className="calm-principle-mark"><OrbitMark size={42} /></div>
        <p>Code tells us what exists.</p>
        <h2>The conversation tells us why.</h2>
        <Link className="calm-button calm-button-dark" to="/signup?next=%2Fworkspace">
          Start with Orbit <ArrowRight size={15} />
        </Link>
      </section>

      <section className="calm-questions" id="questions">
        <div className="calm-questions-heading">
          <p className="calm-label">FAQ</p>
          <h2>Frequently asked <span>questions.</span></h2>
          <p>Orbit is designed to stay simple: local when you need privacy, shared when the work is ready.</p>
        </div>

        <div className="calm-accordion">
          {questions.map((item, index) => {
            const isOpen = openQuestion === index;
            return (
              <div className={"calm-question " + (isOpen ? "is-open" : "")} key={item.question}>
                <button
                  onClick={() => setOpenQuestion(isOpen ? null : index)}
                  aria-expanded={isOpen}
                >
                  <span>{item.question}</span>
                  <ChevronDown size={17} />
                </button>
                {isOpen && <p>{item.answer}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <footer className="calm-footer">
        <div className="calm-footer-intro">
          <a className="calm-brand" href="#top"><OrbitMark size={28} /> <span>orbit</span></a>
          <p>Conversation history for the way software gets built now.</p>
        </div>
        <div className="calm-footer-links">
          <div><strong>Product</strong><a href="#features">Features</a><a href="#workflow">Workflow</a><Link to="/signup">Create account</Link></div>
          <div><strong>Resources</strong><a href="https://github.com/ayghri/i-have-adhd" target="_blank" rel="noreferrer">GitHub</a><a href="#questions">Questions</a><Link to="/login">Log in</Link></div>
        </div>
        <div className="calm-footer-bottom">
          <span>Built in the open.</span>
          <span>Local first. Git backed.</span>
        </div>
      </footer>
    </main>
  );
}
