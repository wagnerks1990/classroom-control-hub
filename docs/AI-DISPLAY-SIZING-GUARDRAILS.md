# AI Guardrails: Display Sizing and Timer Chrome

This file is AI-facing implementation context for future Classroom Control Hub changes.

## Required invariants

- `public/display/layout.mjs` is the single sizing authority.
- The logical display canvas is always 1920x1080. Physical resolution and DPR only scale the finished stage.
- Configured scene font sizes are design inputs, not hints to discard.
- With `autoFit` enabled, growth is bounded to 10 percent above the configured size and by the absolute component cap. Shrinking for containment is always allowed.
- With `autoFit:false`, the configured value is the ceiling and shrinking for containment is still allowed.
- Do not change auto-fit back to selecting the largest size up to a global cap; that caused the 2026-09-09 oversized-text regression.
- The timer owns a separate reserved region so digit changes do not reflow body content.
- The visible timer overlay must remain content-sized and centered. Do not force `width:100%` unless a future explicit full-width timer style is introduced as an opt-in feature.
- Timer ticks must not trigger global title/subtitle/body refitting.
- Future display changes must preserve containment and no-overlap behavior on Chromium and Firefox and across 1080p, 4K, DPR 1/2, and narrow operator-window fixtures.

## Known regression signature

If diagnostics for a normally configured scene suddenly show values near title 118, subtitle 82, body 120, and timer 132, while the configured values are around 72/40/54/75, auto-grow has regressed to absolute-cap behavior.

Renderer revision correcting this: `single-fit-20260911-5`.

See `docs/DISPLAY-SIZING-RECOVERY.md` for operator verification and recovery details.
