# Task-focused operator workspace

Status: development UI rebuild, reconciled with main commit `9e0cacd` (Veyon, Music Assistant, direct display URLs, and automation fixes). This is not a release or a deployment confirmation. It replaces the controller's navigation and page hierarchy through a shared enhancement layer, while retaining the existing feature editors and device-control implementation.

## Everyday navigation

| Workspace | Tools | Existing page IDs |
| --- | --- | --- |
| Today | Classroom today and teaching shortcuts | `overview` |
| Teach | Screen content, Presentations, Classroom computers | `display`, `presentations`, `lab` |
| Room | Screens & AV, Lighting, Music | `av`, `lights`, `music` |
| Library | Media library | `media` |
| Plan | Classes & schedule, Automations | `classes`, `schedules` |
| Admin | Settings, Diagnostics, System & recovery | `settings`, `diagnostics`, `system` |

All thirteen existing pages remain available according to the signed-in account's permissions. A workspace shows only its relevant secondary navigation. During a browser session, returning to a workspace reopens the last tool used in that workspace. The remembered tool is held only in page memory, not persisted in browser storage or across reloads.

**Find a tool** searches a small, static navigation catalog. Press Ctrl+K or Command+K; type a name such as timer, Veyon, lights, PowerPoint, or backups. Use arrow keys and Enter, or choose a result with the pointer. Escape closes search and restores focus. Search indexes tool names and synonyms, not student data, page content, passwords, configuration fields, or logs. Search results navigate; they never execute a device command.

## Today

The landing page puts today's class and display availability above four teaching shortcuts: put content on screen, open timer controls, present a deck, and check classroom computers. A shortcut opens the existing editor; it does not send content, start a timer, connect to a computer, or issue a hardware command automatically.

Power and lighting actions move into **Room power & lighting**. Connection details move into **Connections & health**, whose collapsed summary still mirrors the original Hub, Lighting, and AV state text. The enhancement does not invent an aggregate healthy state or reinterpret unavailable integrations. Original display previews and refresh behavior remain in place.

**Clear classroom** retains the original handler and its behavior. It is not changed into a new session-ending API or placed inside the search catalog.

## Screen-content workflow

Open **Teach → Screen content**. Choose target screens in the left column, then prepare content in the editor. The current target-selection summary is mirrored beside the editor so the operator can see the intended scope. The editor appears before the large live preview. Expand **Live preview** when needed; opening it dispatches a resize event for the existing preview scaler.

Display, Timer, Media, and Scenes remain directly accessible. Lighting, AV, Settings, and Diagnostics remain under **More tools** within this embedded console. Title/subtitle colors and sizes move into **Text appearance**. Original inputs, target selections, IDs, event listeners, and action buttons are moved rather than recreated.

The Today timer shortcut and `#/display/timer` deep link activate the original timer workspace after its lazy iframe is ready. They do not start a timer. Internal iframe tool changes are not currently mirrored back into the parent URL.

## Administration and shared styling

Admin retains the existing forms and APIs. Top-level titled panels become expandable sections, with the first available section open. This reduces simultaneous detail without deleting controls. Existing details, nested panels, action authorization, confirmations, and encrypted-secret handling remain authoritative.

The controller, embedded display editor, Windows-agent console, Veyon console, and setup pages share calmer surfaces, spacing, typography, input sizing, focus treatment, and reduced-motion rules. Deep feature-specific forms outside the display editor are retained rather than rewritten into new wizards. Setup receives the shared styling, not a new provisioning backend.

The palette follows the existing brand primary color. Dark, light, and system presentation modes are supported by the design layer. Custom theme combinations still need visual review; this change is not a formal accessibility certification. **Compact view** changes panel spacing and stores only `hub.workspace.density` in local browser storage. Unavailable storage does not prevent operation.

At narrow widths, the primary workspaces collapse behind a **Workspaces** button. This is an in-page disclosure, not an overlay; Escape closes it. Desktop and mobile share the same route and permission model. Tables and device matrices retain their dedicated scrolling areas.

## Implementation and safety boundaries

`public/shared/branding.js` loads `workspace.js` only on an explicit controller/setup path allowlist. `workspace.js` waits for its stylesheet to load before enhancing the DOM. Failed enhancement assets leave the original interface available. `workspace.css` is scoped to `html.hub-ui`.

The workspace delegates to the original `showPage` and `showWorkspace` functions. It does not wrap or replace the server APIs, display-access model, scheduler, media delivery, or authentication. It observes selected page/auth attributes instead of adding a new status polling loop. Native Veyon adoption, stable receiver IDs, priority announcements, timer continuation, background-music recovery, and database/update safety are outside this change and must remain intact.

Visibility uses the signed-in user, original page authorization attributes, and original navigation hidden state. Visibility is not a security boundary: existing server authorization remains mandatory. New navigation is built with text nodes, not injected HTML or evaluation. No credentials or live classroom data are introduced into public defaults or fixtures. Kyle Wagner attribution remains in the original pages.

Real receivers at `/display/...`, the document viewer, the Ant Media player, Schoology, and the lab-agent payload are not enhanced. In particular, an operator styling change must never alter content rendered on classroom TVs.

## URLs and fallback

Supported examples are `/controller/#/overview`, `/controller/#/classes`, and `/controller/#/display/timer`. Route and display-tool names are allowlisted. Browser Back restores the previous page, including the initial unfragmented home URL. An unauthorized deep link must not reveal its destination.

Use **Use classic layout**, or open `/controller/?workspace=classic`, to bypass the enhancement without changing server configuration or data. Same-origin embedded consoles inherit this choice from their parent. Remove the query parameter to return to the new layout. This is a UI fallback, not a source/database rollback or a fix for backend connectivity.

## Validation

Run the ordinary project validation and the focused checks:

```bash
node --check public/shared/workspace.js
node --check public/shared/branding.js
node --test test/workspace.test.js
python -m pip install playwright==1.57.0
python -m playwright install chromium
python tools/test-workspace-ui.py
```

`CHROMIUM_PATH` can select an already installed browser. The browser script starts an isolated loopback fixture server and uses synthetic classroom data, mocked authentication, mocked routing, and no device/API writes. It covers grouped navigation, Back, initial deep links, search and keyboard focus, iframe timer selection, collapsed preview, retained field listeners, permission changes, logout, classic fallback, density preference, and a 390-pixel mobile viewport. It produces clearly labeled mock desktop/mobile preview images.

During development, Chromium URL navigation was restricted in the execution environment. The browser behavior checks passed through an offline `set_content` adapter using those fixtures and the actual workspace JS/CSS. The conventional HTTP fixture runner and full application integration are separate verification steps, not implied by that result. Local Node checks passed, with the canonical real-markup check skipped where the full checkout was unavailable; that check runs under normal repository tests.

Before merging/releasing, inspect CI and exercise the actual application with administrator, teacher, and read-only accounts. Test screen selection, content send/clear, presentations, Veyon and Windows consoles, lighting, AV routing, priority announcements and music recovery, class timers, configuration saves, direct display URLs, and Windows-agent enrollment. Review large rosters, no devices, offline integrations, custom branding, keyboard-only use, and 200% zoom. Retain the existing install/update backup procedures. Do not claim live-device verification or every-editor usability review based on fixture tests.

## Follow-on work and AI contributors

This foundation intentionally retains the feature editors. Subsequent work can simplify the automation editor, presentation/library organization, Veyon/Windows workflows, and setup sequencing individually with feature-level tests. Read [WORKSPACE-AI-CONTEXT.md](WORKSPACE-AI-CONTEXT.md) and the scoped `public/shared/AGENTS.md` before extending the UI. The wiki mirror has a companion Controller Workspace page; live Wiki publication is handled by the existing sync workflow after a merge and must be verified separately.
