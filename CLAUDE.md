# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working with the owner

- The owner writes prompts in **Spanish**. Reply in Spanish.
- Write all code, identifiers, code comments, in-game text, commit messages, issues, PRs, `README.md` and repo documentation in **English**.
- Add explanatory comments to non-obvious or performance-critical sections: instancing and matrix math, collision logic, pooling, the game loop, the responsive camera, CI and release scripts. Explain *why* and *how*. Don't comment trivial lines.
- The owner works from more than one PC, so project context must live in repo files (this file and the README), not in local memory.
- The repo is **`fpsoto/war-is-war`** (public) on the owner's **personal** GitHub account. The development PC also has the employer's git account.
  - Before committing or pushing, check that `git config user.email` is the personal one (`fmaster.ic@gmail.com`) and that `fpsoto` is the active `gh` account (`gh auth switch -u fpsoto`).
  - Never add a remote under the employer's organization.
  - On the main development PC `git` is not on PATH. Use GitHub Desktop's bundled binary: `%LOCALAPPDATA%\GitHubDesktop\app-<version>\resources\app\git\cmd\git.exe`.

## Working agreements

Work is tracked with GitHub Issues. Apply these rules to every change:

1. **Issue first.** Every change starts from an issue opened from a template (Feature or Bug) with context, scope, acceptance criteria and technical notes. Blank issues are disabled.
2. **Branch per change**, created from **`develop`**: `feature/<N>-short-name`, `bug/<N>-short-name` or `chore/<N>-short-name`. Commits reference the issue with `refs #N`.
3. **PR into `develop`** using the PR template: first line `Closes #N`, then `## Summary` (what was implemented) and `## Test plan`. Merge with **Create a merge commit**.
4. **The issue closes when its PR is merged into `develop`**, not at release. GitHub only auto-closes on the default branch (`main`), so `.github/workflows/close-linked-issues.yml` closes the referenced issues and posts the PR's Summary as the closing comment.
5. **`main` only receives releases**, through a `release/X.Y.Z` branch (see "Versions and releases" below). A push to `main` that isn't a release merge makes the release workflow fail on purpose.
6. **No AI attribution**: no `Co-Authored-By` trailers or "Generated with…" lines in commits or PRs. Author: `Felipe Parra <fmaster.ic@gmail.com>`, set in the repo's local git config.

Issues and PRs share one number sequence. Labels: `feature`, `bug`, `chore`, plus `area: gameplay`, `area: visuals`, `area: ui`, `area: infra` and `area: docs`.

`main` and `develop` are protected: no force pushes, no deletion, changes through PRs, and CI must pass.

### Sprints and the project board

- Every issue and PR is **assigned to `fpsoto`**, gets the milestone of the version it targets, and is added to the GitHub Project **"War is War"** (owner `fpsoto`) with **Status** (Todo / In Progress / Done), **Priority** (Critical / High / Medium / Low) and **Sprint** set.
- Sprints are **2 weeks**, Thursday to Wednesday, on the same calendar as fpsoto/fuel-control: Sprint 2 = 2026-10-22 → 2026-11-04, Sprint 3 = 2026-11-05 → 2026-11-18, and so on. Add iterations to the `Sprint` field (Project settings) before they run out.
- A sprint's issues usually target the next minor version. Its milestone carries the sprint dates in its description.
- Issues not planned into a sprint stay without one (the backlog), with a Priority.

### Versions and releases

- Semver. `0.x` = pre-production. **`1.0.0` = the first public launch.** One milestone per version (`v0.1.0`, `v0.2.0`, …, `v1.0.0`).
- **A release is a branch, never a hand-made tag.** The name of the `release/X.Y.Z` branch is the single source of the version:
  1. When the version's milestone is done (usually at the end of a sprint), cut **`release/X.Y.Z` from `develop`** and push it. CI on it reports `X.Y.Z-rc.<run>`.
  2. Only release fixes go on the branch, each through its own issue and a PR into `release/X.Y.Z`.
  3. Open the PR `release/X.Y.Z` → `main` titled `Release X.Y.Z` and merge it with **Create a merge commit**. That merge is the release.
  4. `.github/workflows/release.yml` then does the rest:
     - builds the site and writes `version.json` with `X.Y.Z`;
     - deploys it to GitHub Pages and **refuses to publish the release unless the live site reports exactly `X.Y.Z`**;
     - creates the GitHub Release and its `vX.Y.Z` tag (a pre-release for 0.x), with `war-is-war-X.Y.Z.zip` attached;
     - closes the `vX.Y.Z` milestone;
     - opens the back-merge PR `main` → `develop`.
  5. Merge the back-merge PR with a merge commit, so `develop` carries the tag. Keep the release branch as the record of the release.
- GitHub Pages is built from Actions, so **the live game only changes on a release**. Merging into `develop` never touches it.
- Never write a version by hand anywhere. `.github/scripts/resolve-version.sh` derives every other CI build's version from the last release tag (`X.Y.Z+<commits>.g<sha>`). Local runs show `dev` on the start screen because there is no `version.json`.

## Project overview

A 3D horde shooter in the browser. Static site, no build step: `index.html` (HUD, overlays, responsive CSS, Three.js import map) and `game.js` (the whole game). Live at https://fpsoto.github.io/war-is-war/.

- Run locally with any static server (`npx serve .`); ES modules don't load from `file://`. `?level=N` jumps to a stage, `?play` skips the start screen.
- Balance lives in `CFG`, `LEVELS` and `POWERUPS` at the top of `game.js`.
- Performance rules (the game animates 500+ enemies on phones):
  - Enemies, bullets and particles are `InstancedMesh`es driven by typed arrays.
  - Never allocate in the game loop. Reuse the module-level scratch objects (`_v`, `_q`, `_mOut`, …).
  - Dispose textures and materials of anything removed at runtime (see `removePanel`).
- CI checks the module syntax and that every `$('id')` used by `game.js` exists in `index.html`.
