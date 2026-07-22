# PWA and Web Push Acceptance Matrix

> Status: **not yet executed**. This document is a repeatable manual release checklist; automated tests do not replace the browser, OS, notification-service, and reverse-proxy checks below.

## Test record

- Date:
- Tester:
- pi-web commit/version:
- Host OS:
- Deployment URL:
- Reverse proxy and version:
- TLS termination:
- Desktop browser and version:
- Android device/OS/browser:
- iPhone or iPad model/iOS or iPadOS version:
- Evidence directory or issue link:
- Log-safe Push endpoint hostname(s) only (never record the full endpoint, keys, password, fingerprint, or VAPID private key):

## Preconditions

- Use a non-production test installation with the application password gate enabled.
- Serve through HTTPS, except that `localhost` may be used for local desktop testing.
- Keep the pi-web process, host, and model network available while testing background completion.
- Do not inspect or copy notification subscription secrets into screenshots or reports.
- Clear old test Service Workers, site data, and notification permissions only when a case explicitly requires a clean state.

## 1. Desktop Chrome or Edge over HTTPS

- [ ] Open pi-web in desktop Chrome or Edge over HTTPS and authenticate.
- [ ] Confirm Pi Web shows **no** install help button, notification bell, or enable/test/disable popover.
- [ ] Confirm the browser’s own installability still works (address-bar / menu install) when criteria are met; install the PWA and launch it in standalone mode if desired.
- [ ] With notification permission still `default`, after the authenticated Push status check succeeds, confirm **one** automatic permission prompt may appear. Allow it once.
- [ ] Reload the page and confirm the versioned marker prevents a second automatic prompt.
- [ ] Confirm no Pi Web UI can send a fixed test notification (use a real Agent settle or a controlled server-side path if testing delivery).
- [ ] Click a delivered system notification when available.
- [ ] Deploy or expose a newer Service Worker and confirm the update banner appears.

**Expected:** no Pi Web install/notification guidance UI; at most one automatic permission attempt while `default` and marker absent; granting creates/reuses and posts a subscription; later permission changes are only via browser/system settings; standalone launch remains authenticated according to normal cookie policy; notification click focuses or opens the same-origin app; the new worker waits until the user confirms the update. Do **not** require the automatic prompt on every browser—if the browser suppresses it without a gesture, Pi Web stays quiet and the marker still prevents repeats.

**Evidence:** no-guidance-UI screenshot, permission state, installed-app screenshot (optional), notification screenshot if delivered, same-origin URL after click, update-banner screenshot.

## 2. Android Chromium over HTTPS

- [ ] Install via the browser’s install affordance (not a Pi Web button) and launch the installed app.
- [ ] Authenticate; allow the single automatic notification permission prompt if shown.
- [ ] Reload and confirm no second automatic prompt.
- [ ] Start an Agent run, wait until the server accepts it, then close the installed app.
- [ ] Wait for the run to settle and click the notification.

**Expected:** closing the app does not stop the accepted server-side run; exactly one generic completion Push arrives after final settle when permission is granted and a subscription exists; clicking opens/focuses pi-web at the matching session. No Pi Web enable control is required or present.

**Evidence:** device/browser versions, settled time, notification screenshot, opened session screenshot.

## 3. iOS 16.4+ or iPadOS 16.4+

- [ ] In Safari, add pi-web to the Home Screen (browser Share sheet—Pi Web does not show install guidance).
- [ ] Launch the installed standalone PWA and authenticate.
- [ ] Observe whether the automatic permission attempt appears. iOS may suppress auto prompts; if suppressed, Pi Web stays quiet and does not show guidance.
- [ ] If permission becomes `granted` (auto or via system settings), start an Agent run, close the PWA, wait for settle, and click the notification.

**Expected:** ordinary Safari tab has no Pi Web install/notification guidance UI; Push requires the installed Home Screen PWA on iOS 16.4+; automatic request is best-effort only and may not surface without a gesture; a generic completion Push arrives only when permission/subscription exist and opens the matching same-origin session.

**Evidence:** OS/device version, Home Screen icon, permission state, notification/click screenshots when applicable.

## 4. Visible foreground ACK suppresses system Push

- [ ] Keep one authenticated pi-web page visible with `/api/agent/running/events` connected.
- [ ] Complete an Agent run normally.

**Expected:** a fixed-copy in-app toast is visibly rendered; its authenticated ACK is sent only after render; no system Push arrives for that notification.

**Evidence:** toast screenshot and browser network entry for the matching `/api/push/presence` ACK. Do not record cookie/body secrets.

## 5. Visible page with ACK blocked

- [ ] Keep the page visible but block or fail `POST /api/push/presence` after the notification frame is received.
- [ ] Complete an Agent run.

**Expected:** the in-app toast may appear, but a system Push follows after approximately the 1.5-second ACK window. A late ACK can produce a harmless toast-plus-Push duplicate; missing the completion entirely is not acceptable.

**Evidence:** toast/notification timestamps and safe network failure status.

## 6. Hidden, frozen, or closed client

- [ ] Repeat with the page hidden, OS-frozen, and fully closed after the server accepts the prompt.

**Expected:** the Agent continues on the server while pi-web, the host, and the model network remain available; no invisible client ACK suppresses delivery; a generic system Push arrives after settle.

**Evidence:** server completion timestamp and notification screenshot for each state.

## 7. Retry, compaction, and queued continuation

- [ ] Exercise automatic retry.
- [ ] Exercise automatic/manual compaction during a run.
- [ ] Exercise steer, follow-up, or a queued continuation within the same run cycle.

**Expected:** no intermediate `agent_end`, retry, compaction, or queued-continuation notification is shown. Exactly one toast or Push is produced only after the final `agent_settled` for the cycle.

**Evidence:** safe event timeline with notification count; do not include prompts or model output.

## 8. Abort

- [ ] Start and then abort an Agent run.

**Expected:** foreground running state settles correctly, but no completion toast or Web Push is generated for an assistant result classified as aborted.

**Evidence:** abort timestamp and absence of notification during an agreed observation window.

## 9. Offline navigation and Cache Storage

- [ ] With the PWA installed, inspect Cache Storage while online.
- [ ] Go offline and navigate or reload.
- [ ] Inspect Cache Storage again.

**Expected:** offline navigation shows only the generic offline fallback. The `pi-web-public-*` cache contains only `/offline.html`, `/manifest.webmanifest`, and the five `/icons/*` PWA assets. It contains no `/api/*`, SSE, authentication page, session, prompt, code, path, tool output, app HTML shell, RSC response, or Next chunk. There is no Background Sync registration.

**Evidence:** redacted Cache Storage key list and offline fallback screenshot.

## 10. Multi-tab Service Worker update

- [ ] Open at least two authenticated tabs controlled by the old worker.
- [ ] Make a newer worker reach the waiting state.
- [ ] Confirm the update in one tab only.

**Expected:** no install-time `skipWaiting()` occurs. Only the confirming tab automatically reloads after `controllerchange`; the other tab shows the activated-version/update prompt and reloads only after its own confirmation.

**Evidence:** before/after screenshots from both tabs and their reload timestamps.

## 11. Password change and subscription epoch

- [ ] Under password A, ensure notification permission is granted (via the one-time auto attempt or browser settings) and a subscription exists; record only the endpoint hostname.
- [ ] Change the application password to B and restart pi-web.
- [ ] Complete a run before re-authenticating with B.
- [ ] Log in with B in the same browser and allow normal headless Push reconciliation without another permission prompt (marker already set; permission remains `granted`).
- [ ] Complete another run.

**Expected:** the password-A subscription is not selected under password B. After login, the browser's existing Push subscription is posted again and rebound to the new password fingerprint without another permission prompt; subsequent delivery works. There is no Pi Web enable control or subscription-status UI to click.

**Evidence:** permission state, safe server-side status/logs if needed (no secrets), notification result before/after rebind.

## 12. Push state invisibility and direct denial

- [ ] Use a session cwd at the home directory and, separately, at the Pi agent directory when permitted.
- [ ] Inspect File Explorer and `/api/file-index` results.
- [ ] Attempt direct encoded reads of `pi-web-push.json`, its temp-file forms, case aliases, and symlink aliases through `/api/files`.
- [ ] Attempt upload/create targets using those protected names and aliases.

**Expected:** Push state and temporary files never appear in listings or session references. Direct reads and write targets are rejected with 403 before existence/conflict details leak; case and symlink aliases do not bypass denial.

**Evidence:** redacted 403 responses and listing screenshots showing no protected names.

## Release decision

- [ ] All applicable cases above passed.
- [ ] Any platform exception is documented with owner and follow-up issue.
- [ ] Screenshots and logs contain no passwords, cookies, full Push endpoints, subscription keys, fingerprints, VAPID private keys, prompts, code, paths, or tool output.
- [ ] Automated test, typecheck, lint, Service Worker syntax, and package checks are attached to the release record.
