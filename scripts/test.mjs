import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const files = readdirSync("tests")
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => "tests/" + file);
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, ORBIT_VIEWER: "0" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
