# Automation Display Media and Class Targets

## Direct display media access

Classroom displays use stable direct URLs such as `/display/tv1` and `/display/tv2` without credentials by default. Per-browser enrollment remains an optional administrator-enabled security mode.

Uploaded media remains protected behind signed, short-lived asset URLs. A connected enabled display receives a device-bound HMAC asset token from the backend and uses that token when loading `/media/*` and `/presentations/*` resources. Stable URL mode must not depend on optional display enrollment for those signed asset requests.

A scheduled event can therefore complete at the automation layer while a display still fails to render media if the browser's asset request is rejected. When troubleshooting a media action, validate both the automation execution and the display's subsequent `/media/...` request.

## Linked class default display targets

`Use class default display targets` is a persisted event preference. It must not be silently cleared merely because the primary event action is lighting or another non-display domain.

For linked-class events, the preference is retained so display-domain actions and future cross-domain target resolution can use the class's configured display defaults. Explicit per-action display targets continue to take precedence where configured.

## Linked automation occurrence metadata

A class-linked automation may retain legacy standalone scheduling fields such as `time`, `scheduleMode`, or `anchorDate`, but those fields are not authoritative for how the linked event appears or runs. The resolved class occurrences are authoritative.

The controller normalizes the list-card time to the first `resolvedOccurrences` time and builds the schedule description from every resolved occurrence. This prevents stale values such as an old manual time or `anchor not set` from being shown for a class-linked automation whose real class times are already known.

Do not use the normalized list-card time to replace the linked-class source of truth in the scheduler. It is presentation normalization only; the backend still resolves each linked class independently.

## Stable text sizing with timer overlays

Display auto-fit is a layout operation, not a timer-tick operation. The renderer may recalculate title, subtitle, body text, and timer sizing when content, timer visibility/style, viewport geometry, or display state changes. It must not globally auto-fit those regions for every countdown digit update.

Running countdowns update the visible timer once per second. Routine timer ticks call the timer painter with `refit:false`; creation, replacement, hide/show, and other layout-affecting timer state changes use `refit:true`. This prevents the auto-fit algorithm from repeatedly setting body text to its configured maximum size and shrinking it again, which otherwise appears on classroom TVs as continuous large/small font flashing.

When changing the display runtime, preserve this invariant: dynamic overlays may repaint frequently, but global layout fitting must be event-driven and idempotent. Do not reintroduce a timer interval that directly calls `fitAllContent()`.

## Test checklist

1. Open the target display with its direct URL and confirm it reports connected.
2. Run an automation with `Display -> Show Image / Video / Document`.
3. Confirm the selected media loads on the display, not merely that the automation reports `Completed`.
4. Edit a linked-class event, enable `Use class default display targets`, save it, reopen the event, and confirm the checkbox remains enabled.
5. Verify explicit cross-domain action targets remain unchanged after save/reload.
6. For a multi-class linked automation, confirm the list uses the first resolved class time and shows all resolved occurrence schedules instead of legacy standalone metadata.
7. Run a multiline `display.text` automation with a timer overlay for at least 30 seconds and confirm title, subtitle, and body font sizes remain visually stable while the countdown changes.
8. Resize a browser preview or change fullscreen state and confirm a one-time auto-fit still occurs.
9. Hide/show or replace the timer and confirm the body region reserves/releases timer space without a persistent resize loop.
