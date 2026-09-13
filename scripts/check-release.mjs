import { readFileSync } from "node:fs";
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (process.argv[2] !== `v${pkg.version}`)
  throw new Error("Release tag must match package.json version");
if (!pkg.license || pkg.license === "UNLICENSED")
  throw new Error("Choose a distribution license before publishing");
