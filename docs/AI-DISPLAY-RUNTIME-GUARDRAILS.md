# AI Display Runtime Guardrails

This file is intended for AI-assisted maintenance, review, and future code generation around Classroom Control Hub display rendering and automation overlays.

## Core invariant

A high-frequency or periodic state update must not trigger a global display layout recalculation unless the update changes geometry or content that affects geometry.

For `public/display/index.html`:

- `fitAllContent()` is a global layout operation.
- `fitText()` temporarily applies a requested maximum font size while measuring content and may then shrink the element.
- Repeatedly invoking global auto-fit during timer ticks causes visible large/small font flashing.
- Countdown digit repaint is not a layout event.
- Timer creation, replacement, visibility changes, style/position changes, viewport changes, fullscreen changes, and new display content are layout events.

## Timer behavior

`paintTimer({refit:false})` is the normal timer-tick path. It updates timer text and presentation only.

`paintTimer({refit:true})` is reserved for a timer state transition that can alter the space available to other display regions.

A running timer uses a 1000 ms interval because the displayed countdown has one-second precision. Do not lower the interval merely for visual smoothness unless sub-second output is intentionally introduced.

## Review rules for AI agents

When modifying display, scheduler, or automation code:

1. Trace whether a periodic callback can reach `fitAllContent()`, `fitText()`, `scaleStage()`, DOM reconstruction, or another geometry-changing operation.
2. Treat repeated full-layout work as a defect unless the underlying geometry is actually changing.
3. Keep timer/clock/status digit updates isolated from title, subtitle, body, media, and viewport layout.
4. Preserve linked-class automation behavior independently from display rendering behavior; scheduler retries/reapplication may resend state but should not create a visual resize loop.
5. Add or update regression coverage when changing any periodic display path.

## Regression coverage

`test/display-timer-autofit.test.js` enforces the timer rendering contract. Any change that makes routine timer ticks call global auto-fit should be treated as a regression and reviewed before merging.
