# Releasing

Confirm npm ownership of `@orbit/cli` and choose a distribution license before the first release. The repository currently records `UNLICENSED`; do not treat public access as an open-source license.

Update `package.json`, its lockfile, and the changelog together. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run format:check`. Inspect `npm pack --dry-run` and test the resulting tarball in a clean temporary installation.

The release workflow is manually dispatched with an existing `v<version>` tag. It checks that the tag matches the package version and refuses to publish while the license is unset. Configure `NPM_TOKEN` in the npm-release GitHub environment and require approval on that environment. The repository does not publish merely because a branch or tag is pushed.

The workflow publishes the executable and bundle with provenance. Internal TypeScript modules, tests, source maps, and dashboard assets are excluded from the npm tarball. `better-sqlite3` remains a native runtime dependency; unsupported platforms may require local compilation.
