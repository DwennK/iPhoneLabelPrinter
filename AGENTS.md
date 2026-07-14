# Project instructions

## Release workflow

- For this repository, a user request to push changes includes a complete
  GitHub release unless the user explicitly says not to create a release.
- Finish and validate the logical implementation commits before starting the
  release commit.
- Inspect the latest application version, Git tag, and GitHub Release. Use the
  next patch version by default unless the user specifies another version.
- Keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` on the same version.
- Create the version bump as a separate, coherent release commit with a
  multi-line English commit message.
- Push the completed commits, create and push the matching `vX.Y.Z` tag, and
  let the existing GitHub Actions release workflow publish the release.
- Do not report completion until the GitHub Release, `latest.json`, signatures,
  and expected platform installers have been verified.
