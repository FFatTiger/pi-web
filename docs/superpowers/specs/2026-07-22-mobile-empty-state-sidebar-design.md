# Mobile Empty-State Sidebar Design

## Goal

On mobile, a page load with no selected session should reveal the session sidebar by default so the user can immediately choose a conversation. The drawer should still get out of the way once a session or new-session flow is chosen.

## Behavior

| Entry state | Mobile behavior | Desktop behavior |
|---|---|---|
| No `?session=` parameter | Open the sidebar after hydration | Unchanged; sidebar starts open |
| Valid `?session=` parameter | Keep the sidebar closed while restoring and show the restored chat | Unchanged |
| Missing/invalid `?session=` target | Open the sidebar after restore resolution reports no selected session | Unchanged |
| User selects a session | Close the sidebar and show the chat | Keep current behavior |
| User starts a new session | Close the sidebar and show the composer | Keep current behavior |

The app will not persist drawer state. A fresh mobile entry without a selected session always returns to the session chooser rather than inheriting a previously closed drawer.

## Implementation

Keep `sidebarOpen` initially true so the empty mobile state can become visible after hydration. Replace the unconditional mobile close effect with conditional initialization: close only when the initial URL contains a session candidate. If URL restoration finishes without selecting a session, the existing restore-complete callback reopens the drawer on mobile. Successful restoration does not invoke that fallback and therefore remains closed.

Existing manual session selection and new-session handlers continue closing the mobile drawer. The pre-hydration `mobileSidebarReady` guard remains unchanged, preventing a drawer animation or layout flash before the mobile breakpoint resolves.

## Testing

Add a focused AppShell contract test that proves:

1. mobile initialization does not unconditionally close the sidebar;
2. a URL session candidate starts with the drawer closed on mobile;
3. failed/absent restoration opens the drawer on mobile;
4. manual session selection and new-session creation still close it;
5. successful URL restoration does not run the empty-state reopen path.

Run the focused test, TypeScript, the complete Node test suite, and a production build before deployment. After deployment, verify the built client artifact contains the conditional behavior and that PM2/public health remain stable.

## Non-goals

- Remembering sidebar state in localStorage.
- Changing desktop sidebar behavior.
- Changing session restoration, routing, or session-list data fetching.
- Changing PWA, Push, or Service Worker behavior.
