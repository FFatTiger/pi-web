# Fork README and Pull Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clearly explain how `FFatTiger/pi-web` differs from upstream `agegr/pi-web`, then publish the completed fork work as a pull request to the fork's `main` branch.

**Architecture:** Add a concise first-screen fork section to both README languages, keep unsupported claims out, and separate the fork checkout path from the upstream npm package path. Verify documentation mechanics and the accumulated runtime branch before pushing a dedicated PR branch.

**Tech Stack:** Markdown, Git, GitHub CLI, Node.js README checker, existing Node test suite, TypeScript, ESLint, Next.js.

## Global Constraints

- `@agegr/pi-web` remains identified as the upstream npm package; do not imply it contains fork-only features.
- Link both `https://github.com/FFatTiger/pi-web` and `https://github.com/agegr/pi-web` directly.
- Describe only evidence-backed repository differences.
- Time-scope the upstream-divergence note to the current review date; it is not a compatibility guarantee.
- Keep English and Chinese README sections equivalent in facts and ordering.
- Target the PR at `FFatTiger/pi-web:main` from `FFatTiger/pi-web:fork-differences-and-production-features`.

---

### Task 1: Add bilingual fork positioning

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: repository evidence from `upstream/main...HEAD`, existing authentication/PWA/worktree/mobile docs, and package metadata.
- Produces: first-screen fork identity, feature-difference table, source checkout path, upstream npm warning, and time-scoped divergence note.

- [ ] **Step 1: Insert the English fork section**

Place `## About this fork` after the screenshot caption and before `## Quick Start`. Include:

```markdown
## About this fork

This repository is the [`FFatTiger/pi-web`](https://github.com/FFatTiger/pi-web) fork of [`agegr/pi-web`](https://github.com/agegr/pi-web). It keeps pi-web's local browser workspace while adding deployment, security, background-notification, multi-project, and mobile behavior used by this fork.

| Area | This fork adds |
| --- | --- |
| Remote access | Fail-closed application password gate ... |
| PWA and completion notifications | Installable PWA ... authenticated VAPID Web Push ... |
| Projects and worktrees | Multi-project session grouping ... |
| Mobile UI | ... |
| Security boundaries | ... |
```

Then add an explicit note:

```markdown
> The npm package `@agegr/pi-web` is published by the upstream project. The `npx` and global-install commands below install upstream, not the fork-specific changes described above.
```

Add a fork checkout command block before the existing upstream npm commands:

```bash
git clone https://github.com/FFatTiger/pi-web.git
cd pi-web
npm install
npm run dev
```

Add a dated upstream divergence note naming Pi 0.81, automatic session naming, Git-aware diff viewer, and `!` / `!!` shell prefixes as upstream-only changes observed on 2026-07-22.

- [ ] **Step 2: Insert the equivalent Chinese section**

Use `## 关于此 Fork`, preserve the same links/table rows/warning/commands/date/facts, and make clear that `@agegr/pi-web` installs upstream.

- [ ] **Step 3: Audit Quick Start labels**

Rename the two existing npm paths so readers understand they are the upstream release path without removing them. Keep port/hostname usage unchanged.

- [ ] **Step 4: Run README mechanical checks**

Run:

```bash
node /Users/proxy/.pi/agent/git/github.com/Windrunner20/github-readme-skill/skills/github-readme/scripts/check-readme.mjs README.md --strict
node /Users/proxy/.pi/agent/git/github.com/Windrunner20/github-readme-skill/skills/github-readme/scripts/check-readme.mjs README.zh-CN.md --strict
git diff --check
```

Expected: both README checks PASS; only an existing license-section notice is acceptable; `git diff --check` exits 0.

- [ ] **Step 5: Commit the README changes**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: explain fork differences"
```

### Task 2: Verify and create the pull request

**Files:**
- Read: all committed changes from `origin/main..HEAD`
- No runtime file changes expected unless verification exposes a release blocker.

**Interfaces:**
- Consumes: completed fork branch and README clarification.
- Produces: pushed branch and GitHub pull request targeting `FFatTiger/pi-web:main`.

- [ ] **Step 1: Run the full Node suite**

Run:

```bash
node --test $(find . -name '*.test.mjs' -not -path './node_modules/*' -not -path './.next/*' -not -path './.worktrees/*' | sort)
```

Expected: exit 0 with no failed, skipped, cancelled, or todo tests.

- [ ] **Step 2: Run static gates**

Run:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
node --check public/sw.js
node public/pwa-package.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 3: Review the accumulated diff**

Request an independent reviewer for `origin/main..HEAD`, emphasizing application-gate security, PWA/Push lifecycle, file boundaries, mobile toolbar behavior, README claims, and production route exports. Fix Critical/Important findings before proceeding.

- [ ] **Step 4: Push the PR branch**

```bash
git push -u origin fork-differences-and-production-features
```

Expected: remote branch is created and local branch tracks it.

- [ ] **Step 5: Create the PR**

Create a PR with base `main`, head `fork-differences-and-production-features`, and a body containing:

```markdown
## Summary
- add a fail-closed local application password gate
- add conservative PWA + authenticated VAPID Web Push with settled-run notifications
- add multi-project/worktree browsing and hardened file boundaries
- refine mobile session selection, toolbar, and session metrics
- explain how this fork differs from upstream and how to run the fork source

## Verification
- full Node test suite
- TypeScript
- ESLint
- Service Worker syntax
- packaged PWA artifact contract
- isolated production build and live deployment smoke tests completed during implementation

## Upstream divergence
This fork currently does not include the upstream changes observed on 2026-07-22 for Pi 0.81, automatic session naming, Git-aware diff viewing, and `!` / `!!` shell prefixes.

## Manual follow-up
- desktop Chromium/Edge PWA and Push acceptance
- Android Chromium acceptance
- iOS/iPadOS 16.4+ Home Screen PWA acceptance
```

Use:

```bash
gh pr create --repo FFatTiger/pi-web --base main --head fork-differences-and-production-features --title "feat: add secure PWA, Push, and multi-project workflow" --body-file <temporary-body-file>
```

- [ ] **Step 6: Report PR URL and branch state**

Run:

```bash
gh pr view --repo FFatTiger/pi-web --json url,title,baseRefName,headRefName,state
git status --short --branch
```

Expected: PR state OPEN, base `main`, head `fork-differences-and-production-features`, and clean working tree.
