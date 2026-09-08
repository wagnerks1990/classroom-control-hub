# Automation Framework

Classroom Control Hub automations are stored in SQLite and execute through a shared framework regardless of whether the primary action controls displays, TV power, lighting, media, or a class-end timer. This document defines the behavior that must remain consistent across all automation types.

## Persistence

SQLite is authoritative. Compatibility helpers may continue to refer to historical JSON filenames such as `automations.json`, but data-directory reads and writes are redirected through `ClassroomHubStorage`. A stale physical JSON file must never be treated as current state when `LEGACY_JSON_MIRROR=false`.

## Linked classes

An automation can link to one or more class schedules. Normal scheduled execution resolves each matching class independently, using that class's effective start/end times and school-cycle rules. Date, cycle, exclusion, and class-enabled checks remain strict for real scheduled runs.

`Test Now` is intentionally different: it validates execution rather than today's calendar eligibility. If no linked class is active or scheduled today, the first enabled linked class becomes a deterministic manual-test context. This permits testing text variables, class-default targets, media, and class-end timer rendering without weakening the real scheduler.

## Class-default display targets

`Use class default display targets` is a display-domain policy and must persist for every automation, including automations whose primary action is lighting or TV power.

When enabled, linked-class default display targets apply to:

- a primary display action;
- display actions added to a lighting- or TV-led automation;
- class-end timer actions;
- the Timer Overlay addon;
- the automatic pre-clear display scope.

Class display targets never become lighting targets. Lighting actions continue to resolve their own lighting targets independently.

## Timer behavior

Scheduled class-end timers require the class to be scheduled on the actual execution date. Manual `Test Now` runs may bypass only that calendar-eligibility check; they still resolve the configured class and its effective end time. If the effective end time has already passed, the renderer may show the terminal `00:00` state rather than inventing a future class period.

Both the standalone `display.timer.class-end` action and the Timer Overlay addon follow this same manual-versus-scheduled contract.

## Alternating schedules

The school schedule profile owns the authoritative alternating-cycle anchor. The automation editor persists that profile anchor rather than depending on a separate editor-only anchor input.

`alternatePhase` remains the stable `A`/`B` identity. Friendly labels such as `Green Days` or `Group B Days` are presentation labels and do not replace the stored phase identifier.

## Test Now and failure reporting

`Test Now` returns the complete automation execution result. The controller surfaces failures by action, and timer overlay failures are reported separately. The backend persists structured failure details in `lastRun.resultSummary.failures` for both manual and scheduled runs.

A successful primary action must not be misdiagnosed as failed merely because a timer overlay failed. Conversely, a failed timer overlay must remain visible as a distinct failure rather than being hidden behind a generic `Completed with action errors` message.

## Regression requirements

Changes to the scheduler or controller must preserve these invariants:

1. Real scheduled runs retain strict school-calendar and cycle enforcement.
2. Manual tests can use a linked class even when it is not scheduled today.
3. Class-default display targets work across primary and cross-domain display actions.
4. The class-default target checkbox survives save/edit cycles regardless of primary action domain.
5. Alternating schedules save the authoritative school-profile anchor.
6. Timer and action failures expose actionable details.
7. SQLite remains the authoritative automation store.

The automated regression coverage for this contract lives in `test/automation-framework-manual.test.js`.
