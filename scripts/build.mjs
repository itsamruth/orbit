import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { chmod, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc"], {
  cwd: root,
  stdio: "inherit",
});
await build({
  absWorkingDir: root,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/orbit.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["better-sqlite3"],
  banner: {
    js: 'import { createRequire as orbitCreateRequire } from "node:module"; const require = orbitCreateRequire(import.meta.url);',
  },
});
await chmod(new URL("../bin/orbit.js", import.meta.url), 0o755);
