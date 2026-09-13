import { randomUUID } from "node:crypto";
import { inspectWorkspace } from "../project/index.js";
import {
  adapters,
  choose,
  continueContext,
  newWorkstream,
  requestStop,
  runAgent,
} from "../sessions/runtime.js";
import { latestConversation } from "../sessions/switch.js";
import { gitText } from "../storage/git/index.js";
import type { CommandContext } from "./context.js";
export async function sessionCommand({
  command,
  args,
  repo,
  pid,
  root,
}: CommandContext): Promise<void> {
  let name = command,
    explicit: string | undefined,
    continuing = args.includes("--continue"),
    at: string | undefined;
  if (command === "continue") {
    explicit = args[0];
    if (
      !explicit ||
      args[1] !== "--agent" ||
      !args[2] ||
      ![3, 5].includes(args.length) ||
      (args.length === 5 && args[3] !== "--at")
    )
      throw new Error(
        "Usage: orbit continue <workstream> --agent <agent> [--at <checkpoint>]",
      );
    name = args[2];
    continuing = true;
    at = args[4];
  }
  if (command === "switch") {
    if (args.length !== 1) throw new Error("Usage: orbit switch <agent>");
    name = args[0]!;
    continuing = true;
  }
  const agent = adapters[name];
  if (!agent) throw new Error("Unknown command. Run orbit help.");
  const capabilities = await agent.probe();
  if (command === "switch") {
    await requestStop(root);
    await repo.exclusive(() => repo.refresh());
    await repo.assertIdle();
    const latest = await latestConversation(repo, pid, root);
    console.error(
      "\nLatest conversation: " +
        latest.workstream.title +
        "\nFrom: " +
        latest.session.agent +
        "  ->  " +
        name +
        "\nSession: " +
        latest.session.id +
        "\nLast activity: " +
        latest.updatedAt +
        "\nPreparing context for " +
        name +
        "...",
    );
    const context = await continueContext(
      repo,
      pid,
      latest.workstream,
      root,
      capabilities.maxContextBytes,
    );
    console.error("Opening " + name + " with this conversation.\n");
    await runAgent(repo, pid, root, latest.workstream, agent, context);
    return;
  }
  await repo.assertIdle();
  let w = at ? null : await choose(repo, pid, root, explicit),
    context: string | undefined;
  if (at) {
    await repo.assertIdle();
    const branch = "continue/" + Date.now() + "-" + randomUUID().slice(0, 8);
    await repo.createBranch(branch, at);
    await repo.checkout(branch);
    w = await choose(repo, pid, root, explicit);
    await repo.setState(
      "continue:origin",
      JSON.stringify({
        checkpoint: await gitText(repo.history, ["rev-parse", "HEAD"]),
        workstreamId: explicit,
      }),
    );
  }
  if (w && !continuing && w.branch !== (await inspectWorkspace(root)).branch)
    w = null;
  if (!w) {
    if (continuing)
      throw new Error("No workstream is available at this revision");
    w = await newWorkstream(repo, pid, root, "Untitled workstream");
  }
  context = continuing
    ? await continueContext(repo, pid, w, root, capabilities.maxContextBytes)
    : undefined;
  await runAgent(repo, pid, root, w, agent, context);
}
