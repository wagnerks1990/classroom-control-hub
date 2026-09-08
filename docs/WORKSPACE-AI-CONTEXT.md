# Workspace UI: AI implementation context

Read root `AGENTS.md` and `docs/AI-CONTEXT.md` first. This file adds UI-specific context; it does not replace the alpha.71 recovery, authentication, scheduling, and native-integration contracts.

## Current implementation

The task-focused workspace is a progressive DOM enhancement over the existing controller. The implementation is `public/shared/workspace.js` and `workspace.css`, loaded by the scoped addition to `branding.js`. The original controller HTML, application routing functions, operation handlers, and backend remain authoritative. All thirteen existing page IDs are mapped to six areas. The display editor is rearranged without replacing its fields. Other existing editors are retained with shared styling and less prominent administrative detail.

Read `docs/WORKSPACE-REDESIGN.md` for the complete navigation map, scope, fallback, and test procedure. Treat the layout as development work until the actual branch's CI and real-app checks are reviewed. Do not infer a release or deployment from screenshots.

## Work boundaries for agents and contributors

These are ownership boundaries for future parallel work, not a claim that separate agents executed this implementation.

| Workstream | Ownership | Required evidence |
| --- | --- | --- |
| Navigation and interaction | Route catalog, search, browser history, keyboard behavior | Route tests, role changes, dialog focus, Back/deep-link checks |
| Visual system | Scoped CSS, responsive layout, brand presentation | Actual-page screenshots at desktop/mobile and zoom; no renderer changes |
| Feature workflows | One editor at a time: display, automation, presentation, computers, setup | Existing IDs/listeners preserved or deliberately migrated; feature-specific integration tests |
| Safety review | Authorization, targets, destructive actions, iframe boundaries | No new bypass; no automatic hardware operation from navigation; fail closed |
| Documentation and release | Controller guide, UI context, wiki mirror, change notes | Accurate scope, test results, limitations, rollout and rollback distinction |

Avoid simultaneous edits to `workspace.js` without explicit coordination. Prefer independent feature modules only after adding a contract and tests. Do not add a frontend framework merely to restyle existing pages.

## Non-negotiable UI rules

Never issue a command while searching, opening a workspace, switching layout, or restoring a deep link. A timer shortcut opens controls; it does not start the timer. Do not silently select all devices. Original target selection and confirmation semantics must survive the redesign.

Never remove or override the original `hidden`, `data-authorized`, `disabled`, or capability state to make a menu visible. The workspace reads the original authorization state; the server still enforces access. Do not index page contents or secrets into navigation search. Use text nodes for generated labels and validate route names against the static catalog.

Reparent original form nodes rather than cloning/replacing them. IDs are referenced by legacy controller code and browser globals. Do not make original `showPage` inspect newly introduced operation buttons. Workspace group navigation deliberately uses links; original route buttons remain in a navigation element for auth lookup.

Keep operator enhancements off `/display/...`, `/document-viewer/...`, `/antmedia-player/...`, Schoology, and agent payload paths. Embedded `/controller/display.html` is an operator editor, not the receiver. Preserve Kyle Wagner attribution and database-driven school branding.

Do not change announcements, music arbitration, timer continuation, Veyon host adoption, database paths, installers, or update/backup behavior as incidental UI cleanup. Those changes require separate targeted implementation and tests.

## Test and reporting discipline

`npm test` includes `test/workspace.test.js`. `tools/test-workspace-ui.py` exercises mock fixtures, not the real backend or classroom hardware. Keep fixtures generic and clearly labeled. The development session used an offline browser adapter because URL navigation was restricted; it did not verify the full application end to end.

Report Node, browser-fixture, full-app, CI, and live-device results separately. A new screenshot is not an integration test. A committed wiki mirror is not proof of a successful live Wiki sync. Keep the classic-layout escape hatch until real-app acceptance covers every affected workflow.
