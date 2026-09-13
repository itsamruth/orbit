#!/usr/bin/env node
import { readFileSync } from "node:fs";

if (["--version", "-v"].includes(process.argv[2])) {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  console.log(version);
} else {
  await import("../dist/orbit.js");
}
