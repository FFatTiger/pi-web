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
- [ ] Confirm the install UI appears, install the PWA, and launch it in standalone mode.
- [ ] Use the explicit notification control to enable notifications; confirm no permission request occurred before that click.
- [ ] Send the fixed test notification.
- [ ] Click the system notification.
- [ ] Deploy or expose a newer Service Worker and confirm the update banner appears.

**Expected:** installation succeeds; standalone launch remains authenticated according to normal cookie policy; opt-in creates a subscription; the test notification uses the fixed local title/body; clicking focuses or opens the same-origin app; the new worker waits until the user confirms the update.

**Evidence:** installed-app screenshot, notification screenshot, same-origin URL after click, update-banner screenshot.

## 2. Android Chromium over HTTPS

- [ ] Install from Android Chromium and launch the installed app.
- [ ] Enable notifications from the explicit control.
- [ ] Start an Agent run, wait until the server accepts it, then close the installed app.
- [ ] Wait for the run to settle and click the notification.

**Expected:** closing the app does not stop the accepted server-side run; exactly one generic completion Push arrives after final settle; clicking opens/focuses pi-web at the matching session.

**Evidence:** device/browser versions, settled time, notification screenshot, opened session screenshot.

## 3. iOS 16.4+ or iPadOS 16.4+

- [ ] In Safari, add pi-web to the Home Screen before attempting notification opt-in.
- [ ] Launch the installed standalone PWA and authenticate.
- [ ] Enable notifications from the explicit control.
- [ ] Start an Agent run, close the PWA, wait for settle, and click the notification.

**Expected:** the ordinary Safari tab only shows installation guidance; permission is requested from the installed standalone PWA after a user gesture; a generic completion Push arrives and opens the matching same-origin session.

**Evidence:** OS/device version, Home Screen icon, standalone notification control, notification/click screenshots.

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

- [ ] Enable Push under password A and record only the endpoint hostname.
- [ ] Change the application password to B and restart pi-web.
- [ ] Complete a run before re-authenticating with B.
- [ ] Log in with B in the same browser and allow normal Push reconciliation without requesting notification permission again.
- [ ] Complete another run.

**Expected:** the password-A subscription is not selected under password B. After login, the browser's existing Push subscription is posted again and rebound to the new password fingerprint without another permission prompt; subsequent delivery works.

**Evidence:** permission state, safe subscription-status UI, notification result before/after rebind.

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
