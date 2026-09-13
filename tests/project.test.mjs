import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  initProject,
  resolveProject,
  inspectWorkspace,
  inspectRepository,
} from "../packages/project/dist/index.js";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "orbit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("initialization from a subdirectory uses repository root and preserves identity", async (t) => {
  const root = await workspace(t);
  execFileSync("git", ["init", "-q", root]);
  const nested = join(root, "src");
  await mkdir(nested);
  const first = await initProject(nested);
  const second = await initProject(root);
  assert.equal(first.root, root);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.config.projectId, second.config.projectId);
  assert.deepEqual(await resolveProject(nested), {
    root,
    config: first.config,
  });
  const config = JSON.parse(
    await readFile(join(root, ".orbit/project.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(config).sort(), ["projectId", "version"]);
  assert.equal((await inspectWorkspace(root)).head, null);
});

test("nested repositories do not inherit a parent project", async (t) => {
  const parent = await workspace(t);
  const outer = await initProject(parent);
  const child = join(parent, "separate-repository");
  await mkdir(child);
  execFileSync("git", ["init", "-q", child]);
  assert.equal(await resolveProject(child), null);
  const inner = await initProject(child);
  assert.notEqual(inner.config.projectId, outer.config.projectId);
});

test("non-Git projects resolve from descendants", async (t) => {
  const root = await workspace(t);
  const project = await initProject(root);
  const child = join(root, "src");
  await mkdir(child);
  assert.equal(
    (await resolveProject(child)).config.projectId,
    project.config.projectId,
  );
  assert.equal((await inspectWorkspace(root)).branch, null);
});

test("malformed project configuration is not overwritten", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, ".orbit"));
  const path = join(root, ".orbit/project.json");
  await writeFile(path, "{broken");
  await assert.rejects(initProject(root));
  assert.equal(await readFile(path, "utf8"), "{broken");
});

test("legacy identities migrate without changing project ownership", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, ".carry"));
  const config = { version: 1, projectId: "prj_legacy" };
  await writeFile(join(root, ".carry/project.json"), JSON.stringify(config));
  const project = await initProject(root);
  assert.equal(project.created, false);
  assert.deepEqual(project.config, config);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, ".orbit/project.json"), "utf8")),
    config,
  );
});
test("conflicting modern and legacy identities fail without overwriting either", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, ".carry"));
  await mkdir(join(root, ".orbit"));
  await writeFile(
    join(root, ".carry/project.json"),
    JSON.stringify({ version: 1, projectId: "prj_old" }),
  );
  await writeFile(
    join(root, ".orbit/project.json"),
    JSON.stringify({ version: 1, projectId: "prj_new" }),
  );
  await assert.rejects(initProject(root), /Conflicting/);
});

test("repository metadata removes remote credentials and query strings", async (t) => {
  const root = await workspace(t);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "remote",
    "add",
    "origin",
    "https://example-user:example-password@github.com/example/project.git?token=example",
  ]);
  assert.equal(await inspectRepository(root), "github.com/example/project");
});
