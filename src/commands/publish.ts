import type { Session } from "../protocol/index.js";
import {
  PublishWorker,
  enablePublishing,
  gitCredentials,
} from "../publishing/worker.js";
import type { CommandContext } from "./context.js";
export async function publishCommand({
  command,
  args,
  repo,
  pid,
  root,
  project,
}: CommandContext): Promise<boolean> {
  if (["push", "fetch", "pull"].includes(command)) {
    if (
      command === "push" &&
      (await repo.state("publish:mode")) === "selected-v1"
    ) {
      await new PublishWorker(repo).flush(undefined, true);
      console.log("push complete");
      return true;
    }
    const remote = args[0] ?? "origin";
    await repo[command as "push" | "fetch" | "pull"](
      remote,
      await gitCredentials(repo, remote),
    );
    console.log(command + " complete");
    return true;
  }
  if (command === "publish") {
    if (args[0] === "select" || args[0] === "unselect") {
      if (!args[1])
        throw new Error("Usage: orbit publish " + args[0] + " <session-id>");
      const sessions = await repo.list<Session>(pid, "session");
      if (!sessions.some((session) => session.id === args[1]))
        throw new Error("Session does not belong to this project");
      const selected = new Set<string>(
        JSON.parse((await repo.state("publish:selected:sessions")) ?? "[]"),
      );
      args[0] === "select" ? selected.add(args[1]) : selected.delete(args[1]);
      await repo.setState(
        "publish:selected:sessions",
        JSON.stringify([...selected]),
      );
      console.log(
        args[0] === "select"
          ? "Session selected for publishing."
          : "Session removed from future publication snapshots. Earlier Git commits retain published data.",
      );
    } else if (args[0] === "preview") {
      const selected = new Set<string>(
        JSON.parse((await repo.state("publish:selected:sessions")) ?? "[]"),
      );
      const sessions = (await repo.list<Session>(pid, "session")).filter(
        (session) => selected.has(session.id),
      );
      let events = 0;
      for (const session of sessions)
        events += (await repo.list(pid, "event", session.id)).length;
      console.log(
        JSON.stringify(
          {
            mode: (await repo.state("publish:mode")) ?? "legacy-full",
            sessions: sessions.map((session) => ({
              id: session.id,
              agent: session.agent,
            })),
            eventCount: events,
          },
          null,
          2,
        ),
      );
    } else if (args[0] === "enable") {
      await enablePublishing(repo, project);
      await new PublishWorker(repo).flush();
      console.log("Automatic publishing enabled for this checkout.");
    } else if (args[0] === "disable") {
      await repo.setState("publish:enabled", "false");
      console.log("Automatic publishing disabled.");
    } else
      throw new Error(
        "Usage: orbit publish enable|disable|select|unselect|preview",
      );
    return true;
  }
  return false;
}
