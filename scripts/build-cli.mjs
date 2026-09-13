import { build } from "esbuild";
import { mkdir, cp, rm } from "node:fs/promises";
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["better-sqlite3"],
  banner: {
    js: 'import { createRequire as orbitCreateRequire } from "node:module"; const require = orbitCreateRequire(import.meta.url);',
  },
};
await mkdir("apps/cli/bundle", { recursive: true });
await build({
  ...common,
  entryPoints: ["apps/cli/src/index.ts"],
  outfile: "apps/cli/bundle/orbit.js",
});
await build({
  ...common,
  entryPoints: ["apps/api/src/receive-hook.ts"],
  outfile: "apps/cli/bundle/receive-hook.js",
});
await rm("apps/cli/bundle/web", { recursive: true, force: true });
await cp("apps/web/dist", "apps/cli/bundle/web", { recursive: true });
