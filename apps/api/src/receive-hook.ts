import { readSnapshot, gitText } from "@orbit/git-store";
import { fingerprint } from "@orbit/local-store";
process.env.ORBIT_RECEIVE_VALIDATE = "1";
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const pid = process.argv[2];
  if (!pid) throw new Error("Missing repository identity");
  for (const line of input.trim().split("\n")) {
    const [old, next, ref] = line.split(" ");
    if (
      !old ||
      !next ||
      !ref ||
      !ref.startsWith("refs/heads/") ||
      /^0+$/.test(next)
    )
      throw new Error(
        "Only conversation branch updates are allowed; deletion is disabled.",
      );
    if (!/^0+$/.test(old)) {
      await gitText(process.cwd(), ["merge-base", "--is-ancestor", old, next]);
    }
    const commits = (
      await gitText(process.cwd(), [
        "rev-list",
        next,
        ...(!/^0+$/.test(old) ? ["^" + old] : []),
        "--max-count=1001",
      ])
    )
      .split("\n")
      .filter(Boolean);
    if (commits.length > 1000)
      throw new Error("Push at most 1000 new checkpoints at a time.");
    for (const oid of commits) {
      const snap = await readSnapshot(process.cwd(), oid);
      if (snap.project.id !== pid) throw new Error("Project identity mismatch");
      const parent = (
        await gitText(process.cwd(), ["show", "-s", "--format=%P", oid])
      )
        .split(" ")
        .filter(Boolean);
      if (parent.length > 1)
        throw new Error(
          "Conversation merges are not supported yet; publish separate branches.",
        );
      if (parent[0]) {
        const previous = await readSnapshot(process.cwd(), parent[0]),
          known = new Map(previous.records.map((r) => [r.data.id, r]));
        for (const record of snap.records) {
          const old = known.get(record.data.id);
          if (
            old &&
            record.kind === "event" &&
            fingerprint(old.data) !== fingerprint(record.data)
          )
            throw new Error("Existing events are immutable");
        }
      }
    }
  }
} catch (e) {
  console.error(
    "Orbit rejected push: " + (e instanceof Error ? e.message : String(e)),
  );
  process.exitCode = 1;
}
