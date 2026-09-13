import { inspectWorkspace } from "../project/index.js";
import type { Session, Workstream } from "../protocol/index.js";
import { confirm } from "../sessions/runtime.js";
import { compare } from "../storage/git/index.js";
import type { CommandContext } from "./context.js";
export async function historyCommand({
  command,
  args,
  repo,
  pid,
  root,
  project,
}: CommandContext): Promise<boolean> {
  if (command === "status") {
    console.log(
      JSON.stringify(
        { ...(await repo.status()), workspace: await inspectWorkspace(root) },
        null,
        2,
      ),
    );
    return true;
  }
  if (command === "commit") {
    if (args[0] !== "-m" || args.length !== 2)
      throw new Error("Usage: orbit commit -m <message>");
    console.log(await repo.checkpoint(args[1]!));
    return true;
  }
  if (command === "log") {
    console.log(JSON.stringify(await repo.log(args[0] ?? "HEAD"), null, 2));
    return true;
  }
  if (command === "diff") {
    if (args.length !== 2) throw new Error("Usage: orbit diff <from> <to>");
    console.log(
      JSON.stringify(await compare(repo.history, args[0]!, args[1]!), null, 2),
    );
    return true;
  }
  if (command === "branch") {
    if (!args[0]) {
      console.log(JSON.stringify(await repo.branches(), null, 2));
      return true;
    }
    await repo.createBranch(args[0], args[1]);
    return true;
  }
  if (command === "checkout") {
    if (args.length !== 1) throw new Error("Usage: orbit checkout <branch>");
    await repo.checkout(args[0]!);
    return true;
  }
  if (command === "remote") {
    if (args[0] !== "add" || args.length !== 3)
      throw new Error("Usage: orbit remote add <name> <url>");
    await repo.remote(args[1]!, args[2]!);
    return true;
  }
  if (command === "history") {
    console.log("Conversation history (latest first)");
    const workstreams = (await repo.list<Workstream>(pid, "workstream")).sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
    for (const w of workstreams) {
      console.log(w.id + " " + w.title + "  " + w.updatedAt);
      const sessions = (await repo.list<Session>(pid, "session", w.id)).sort(
        (a, b) =>
          Date.parse(b.endedAt ?? b.startedAt) -
          Date.parse(a.endedAt ?? a.startedAt),
      );
      for (const s of sessions)
        console.log(
          "  " +
            s.id +
            " " +
            s.agent +
            " " +
            s.status +
            "  " +
            (s.endedAt ?? s.startedAt),
        );
    }
    return true;
  }
  if (["session", "workstream"].includes(command)) {
    if (args[0] !== "delete" || !args[1])
      throw new Error("Usage: orbit " + command + " delete <id>");
    await confirm(
      "Remove this " +
        command +
        " from the current branch? Earlier Git commits retain it.",
    );
    await repo.remove(pid, command as "session" | "workstream", args[1]);
    await repo.checkpoint("Remove " + command + " " + args[1]);
    return true;
  }
  return false;
}
