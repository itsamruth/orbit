import type { CommandContext } from "./context.js";
export async function memoryCommand({
  command,
  args,
  repo,
  pid,
  root,
  project,
}: CommandContext): Promise<boolean> {
  if (command === "import") {
    const memory = await import("../intelligence/memory.js");
    const agentIndex = args.indexOf("--agent");
    const only =
      agentIndex >= 0 &&
      ["codex", "claude"].includes(args[agentIndex + 1] ?? "")
        ? (args[agentIndex + 1] as "codex" | "claude")
        : undefined;
    const candidates = await memory.listImportCandidates(repo, pid, root, only);
    if (args.includes("--list") || args.includes("--json")) {
      console.log(JSON.stringify({ items: candidates }, null, 2));
      return true;
    }
    const explicit: string[] = [];
    for (let i = 0; i < args.length; i++)
      if (args[i] === "--session" && args[i + 1]) explicit.push(args[++i]!);
    let selected = args.includes("--all")
      ? candidates
          .filter(
            (x) => x.importState !== "current" && x.importState !== "conflict",
          )
          .map((x) => x.id)
      : explicit;
    if (!selected.length) {
      for (const candidate of candidates.filter(
        (x) => x.importState === "new" || x.importState === "updated",
      )) {
        console.log(
          candidate.agent +
            "  " +
            (candidate.firstPrompt ?? candidate.nativeSessionId) +
            "  " +
            candidate.updatedAt,
        );
        try {
          await confirm("Import this conversation?");
          selected.push(candidate.id);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "Cancelled")
            throw error;
        }
      }
    }
    if (!selected.length) {
      console.log("No conversations selected.");
      return true;
    }
    const result = await memory.importHistoricalSessions(
      repo,
      pid,
      root,
      selected,
      args.includes("--summarize"),
    );
    console.log(
      "Imported " +
        result.sessions.length +
        " conversation" +
        (result.sessions.length === 1 ? "" : "s") +
        ".",
    );
    return true;
  }
  if (command === "providers") {
    const { listProviders } = await import("../intelligence/memory.js");
    console.log(JSON.stringify({ items: await listProviders() }, null, 2));
    return true;
  }
  if (command === "intelligence") {
    if (args[0] !== "configure")
      throw new Error(
        "Usage: orbit intelligence configure --provider <codex|claude> [--auto on|off]",
      );
    const providerIndex = args.indexOf("--provider");
    const provider = args[providerIndex + 1];
    if (!providerIndex || !["codex", "claude"].includes(provider ?? ""))
      throw new Error("Choose --provider codex or --provider claude");
    const autoIndex = args.indexOf("--auto");
    const auto = autoIndex < 0 ? true : args[autoIndex + 1] === "on";
    const { setIntelligenceSettings } =
      await import("../intelligence/memory.js");
    console.log(
      JSON.stringify(
        await setIntelligenceSettings(repo, {
          provider: provider as "codex" | "claude",
          autoSummarize: auto,
          maxInputBytes: 48000,
        }),
        null,
        2,
      ),
    );
    return true;
  }
  if (command === "summarize") {
    if (!args[0])
      throw new Error(
        "Usage: orbit summarize <session-id> [--provider <codex|claude>] [--force]",
      );
    const providerIndex = args.indexOf("--provider");
    const provider =
      providerIndex >= 0
        ? (args[providerIndex + 1] as "codex" | "claude")
        : undefined;
    if (provider && !["codex", "claude"].includes(provider))
      throw new Error("Unsupported provider");
    const { summarizeSession } = await import("../intelligence/memory.js");
    const summary = await summarizeSession(
      repo,
      pid,
      args[0],
      provider,
      args.includes("--force"),
    );
    console.log(JSON.stringify(summary, null, 2));
    return true;
  }
  return false;
}
