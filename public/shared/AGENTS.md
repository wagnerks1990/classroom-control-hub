# Shared operator UI contract

Root `AGENTS.md` still applies. Before editing workspace UI, read `docs/WORKSPACE-AI-CONTEXT.md` and `docs/WORKSPACE-REDESIGN.md`.

- `branding.js` supplies existing database branding and scope-gates workspace loading. Do not weaken the operator path allowlist.
- `workspace.js` reorganizes existing DOM nodes. Preserve stable IDs, original listeners, target selections, capability state, and the original `showPage`/`showWorkspace` implementations.
- Navigation and search never issue hardware or configuration writes. Search only the static route catalog.
- `workspace.css` must stay scoped to `html.hub-ui`. Never apply this styling to classroom receiver or player surfaces.
- Keep native dialog/disclosure behavior, keyboard focus, reduced motion, and the `?workspace=classic` fallback.
- Store only presentation preferences locally; never credentials, student data, or remembered device targets.
- Keep attribution present. Update controller documentation, the UI AI-context file, and the wiki mirror when behavior changes.

Run `node --test test/workspace.test.js`, the repository validation, and browser fixture checks. Distinguish fixture, actual-application, and live-device testing in every report.
