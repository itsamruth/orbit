import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const exec = promisify(execFile);
test("public executable resolves help and version outside a project", async () => {
  const bin = resolve("bin/orbit.js");
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const version = await exec(process.execPath, [bin, "--version"], {
    cwd: "/tmp",
  });
  assert.equal(version.stdout.trim(), pkg.version);
  const help = await exec(process.execPath, [bin, "help"], { cwd: "/tmp" });
  assert.match(help.stdout, /orbit switch/);
  assert.match(help.stdout, /orbit dashboard/);
  assert.doesNotMatch(help.stdout, /orbit serve/);
});
test("dashboard is a configured external service", async () => {
  const options = {
    env: { ...process.env, ORBIT_SERVER_URL: "https://orbit.example" },
  };
  const result = await exec(
    process.execPath,
    ["bin/orbit.js", "dashboard"],
    options,
  );
  assert.equal(result.stdout.trim(), "https://orbit.example");
  await assert.rejects(
    exec(process.execPath, ["bin/orbit.js", "serve"], options),
    /separate|orbit-dashboard/,
  );
});
