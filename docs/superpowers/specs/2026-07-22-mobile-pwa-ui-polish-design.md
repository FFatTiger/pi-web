# Mobile PWA UI Polish Design

**Date:** 2026-07-22  
**Branch:** `feat/mobile-pwa-ui-polish`  
**Base:** `8fab342`

## Goal

Make the mobile interface stay at its normal scale when the software keyboard opens, remove the install/notification guidance controls, request notification permission once automatically, and move logout into the sidebar header controls.

## Scope

### 1. Prevent mobile focus zoom

Mobile browsers, especially iOS Safari, zoom focused editable controls whose computed font size is below 16px. Pi Web currently has editable controls at 11px and 14px.

Add a mobile-only global rule for `input`, `textarea`, and `select` with `font-size: 16px !important`. The `!important` is necessary because several controls use inline font-size styles. Do not add `maximum-scale=1` or `user-scalable=no`; users must retain manual pinch zoom for accessibility.

### 2. Remove guidance controls

Stop rendering these UI surfaces:

- automatic PWA install prompt;
- lower-left Install help button;
- notification bell and its enable/test/disable/settings popover;
- iOS notification-install guidance.

Keep these operational surfaces:

- offline status banner;
- user-confirmed Service Worker update banner;
- foreground Agent completion toast.

PWA installability, manifest, Service Worker registration, offline fallback, update lifecycle, and Web Push support remain implemented; only the guidance/settings UI is removed.

### 3. One automatic notification permission attempt

Mount Web Push reconciliation headlessly from `AppShell`.

Behavior:

1. If Push APIs or secure context are unavailable, do nothing and show no guidance.
2. Check the authenticated Push server before requesting permission.
3. If `Notification.permission === "default"` and the browser has not been auto-prompted by this Pi Web origin before, write a versioned localStorage marker **before** calling `Notification.requestPermission()`.
4. Request permission once. If the result is `granted`, create or reuse the browser subscription and post it to the authenticated server.
5. If the request is blocked, rejected, remains `default`, or returns `denied`, remain silent and never auto-request again for that marker version.
6. If permission was already `granted`, create/reuse and reconcile the subscription without another permission request.
7. Existing browser/system notification settings remain the user's way to revoke permission; Pi Web no longer exposes enable/disable/test buttons.

The marker prevents repeated prompts across reloads and React StrictMode remounts. A rare simultaneous first load in multiple tabs may still be governed by the browser's own permission prompt serialization.

### 4. Move logout to the sidebar header

Remove the fixed bottom-right authentication/notification control group from `AppShell`.

Render `AuthControls` in `SessionSidebar`'s header control row immediately after the Refresh and Open directory buttons. Add a compact presentation for this location:

- 32×32 icon-only button;
- same logout endpoint and redirect behavior;
- compact disabled-auth warning icon when authentication is explicitly disabled;
- no floating shadow or desktop text label.

The directory popover remains anchored to the same header control group and must continue to open correctly.

## Components and boundaries

- `app/globals.css`: mobile editable-control font-size floor.
- `hooks/useWebPush.ts`: one-time auto-permission and headless subscription reconciliation.
- `components/AppShell.tsx`: mount `useWebPush`, remove install/notification controls, retain offline/update/toast.
- `components/AuthControls.tsx`: compact sidebar variant.
- `components/SessionSidebar.tsx`: render compact logout beside header controls.
- Existing guide component files may be deleted if no production caller remains.
- README and acceptance documentation must describe the new automatic one-time permission behavior rather than an explicit Enable button.

## Error handling and privacy

- Permission and subscription failures do not block AppShell or SSE.
- No error popover or guidance is rendered.
- The automatic path uses the existing authenticated, same-origin, bounded Push APIs.
- No permission state, endpoint, key, password, or Push error detail is logged to the browser UI.
- Existing generic notification payload and cache boundaries remain unchanged.

## Tests

Add or update regression coverage for:

- mobile editable controls have a 16px font floor and viewport pinch zoom is not disabled;
- AppShell no longer imports or mounts install/settings/notification controls;
- AppShell still mounts offline, update, toast, presence, and headless Web Push reconciliation;
- permission is automatically requested only when state is `default` and the versioned marker is absent;
- marker is written before requesting permission and prevents a second request;
- granted permission creates/reuses and posts a subscription;
- denied/unsupported/server-unavailable cases stay quiet;
- sidebar contains compact `AuthControls` after Refresh/Open directory controls;
- no fixed bottom-right auth/notification group remains;
- existing PWA update, Presence ACK, logout, sidebar, and Push protocol tests continue to pass.

## Deployment

Implement and verify in the isolated worktree. After tests, typecheck, lint, and production build pass, merge locally into `main`, rebuild, restart the existing PM2 production process with its current command/config/environment, and verify `https://pi.huu.im` plus protected/public PWA endpoints.
