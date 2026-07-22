# Fork README Positioning Design

## Goal

Make the repository identity clear on the first README screen: this repository is the maintained `FFatTiger/pi-web` fork of `agegr/pi-web`, and its extra security, remote-operation, PWA/Push, workspace, and mobile features are not part of the upstream npm package unless explicitly merged there.

## Reader path

Both `README.md` and `README.zh-CN.md` will add an `About this fork` / `关于此 Fork` section immediately after the opening description and screenshot/caption. This placement lets a visitor understand the repository relationship before following Quick Start commands.

The section will contain:

1. Direct links to the fork and upstream repositories.
2. A compact table of evidence-backed differences:
   - fail-closed application password gate;
   - installable conservative PWA and authenticated VAPID Web Push;
   - server-owned Agent continuation plus rendered-toast ACK / Push fallback;
   - multi-project session grouping and Git worktree-aware Explorer;
   - mobile/PWA toolbar, focus-zoom, session chooser, and session metric refinements;
   - stricter file boundaries, Push secret denial, request-size limits, and Push target validation.
3. An installation warning that `npx @agegr/pi-web@latest` and `npm install -g @agegr/pi-web` install the upstream package, not this fork.
4. A source checkout quick path for this fork (`git clone`, `npm install`, `npm run dev`) without claiming a separately published fork package.
5. A short upstream-divergence note naming current upstream-only changes observed at review time: Pi dependency 0.81, automatic session naming, Git-aware diff viewing, `!` / `!!` shell prefixes, and related upstream maintenance changes. It will be explicitly time-scoped so it does not become a permanent compatibility guarantee.

## Scope and accuracy

The existing upstream Quick Start remains available and is relabeled as the upstream npm-package path. The fork checkout path appears first for readers who want the features documented in the fork section.

No feature will be claimed unless present in repository code/docs. The section will avoid superiority language and will state that the fork is currently divergent rather than pretending it is a drop-in release channel for upstream.

## Verification and PR

- Run the strict README checker for English and Chinese.
- Check relative links and commands against repository paths/scripts.
- Run the project test suite and production-safe static gates before creating the PR.
- Push `fork-differences-and-production-features` to `FFatTiger/pi-web` and create a PR targeting that repository's `main`.
- The PR body will summarize the full fork feature set, README clarification, verification evidence, upstream divergence, and manual PWA/browser acceptance still required.
