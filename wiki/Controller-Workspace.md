# Controller Workspace

The development workspace organizes Classroom Hub around teaching tasks while retaining the existing control engine and feature editors.

| Area | Tools |
| --- | --- |
| Today | Class/day status, display availability, teaching shortcuts |
| Teach | Screen content, Presentations, Classroom computers |
| Room | Screens & AV, Lighting, Music |
| Library | Media library |
| Plan | Classes & schedule, Automations |
| Admin | Settings, Diagnostics, System & recovery |

Only tools permitted for the signed-in account appear. **Find a tool** (Ctrl+K or Command+K) searches tool names and familiar terms such as Veyon, timer, lights, or backups. It navigates without executing commands. Arrow keys, Enter, and Escape are supported.

## Day-to-day flow

Start at **Today** to see the class and display status. Use a teaching shortcut to open screen content, timer controls, presentations, or classroom computers. Power and lighting controls remain under an expandable section. **Connections & health** keeps a state summary visible even while its details are closed.

Under **Teach → Screen content**, choose screens before preparing content. The editor comes before the large live preview and repeats the selected-screen summary. Expand the preview or text-appearance options when needed. Less-used embedded console tools remain under **More tools**. No shortcut automatically sends content, starts a timer, or changes a device.

Admin pages keep their existing forms in expandable sections. Compact view changes spacing only. The mobile **Workspaces** button opens the in-page navigation. School branding and Kyle Wagner attribution remain in place.

## Fallback and verification

**Use classic layout**, or `/controller/?workspace=classic`, restores the original layout without changing stored configuration. Embedded same-origin controllers inherit the choice. Remove that parameter to return to the new workspace. This is not a backend repair or a source/database rollback.

The new UI has isolated mock-fixture tests. Those tests do not establish live Veyon connectivity, TV output, announcement/music priority, or database health. Full-application and classroom-device checks remain required before release. The initial work changes the navigation, shared styling, Today view, display-editing hierarchy, and admin disclosure; it does not replace every feature editor with a new wizard.

For implementation and testing, see `docs/WORKSPACE-REDESIGN.md` in the matching repository branch. AI contributors must also read `docs/WORKSPACE-AI-CONTEXT.md` and `public/shared/AGENTS.md`. This Git-tracked page is published by the existing Wiki sync workflow after merge; branch changes alone do not update the live Wiki.
