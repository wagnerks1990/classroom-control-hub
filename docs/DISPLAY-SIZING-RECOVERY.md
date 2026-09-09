# Display Sizing Recovery

## 2026-09-09 regression

A renderer change allowed `autoFit` to grow title, subtitle, body, and timer text directly to global maximums whenever space was available. On normal classroom scenes this changed configured values such as 72/40/54/75 into approximately 118/82/120/132 logical pixels. The result was visually oversized text, clipped heading glyphs on some receivers, and a timer that dominated the display.

The same change forced the timer overlay to `width: 100%`, which turned the historic compact white timer border into a nearly full-width horizontal box.

## Correct behavior

`public/display/layout.mjs` remains the only layout owner. The 1920x1080 logical stage remains unchanged and physical TV resolution/DPR remain scaling-only inputs.

Configured scene sizes are again the visual baseline. With automatic fitting enabled, a component may grow by at most 10 percent above its configured size, subject to the existing absolute safety caps. It may always shrink as much as needed to remain inside its assigned logical region. `autoFit:false` continues to use the configured size as a hard ceiling while still shrinking on overflow.

Examples:

- body size 54 -> automatic ceiling 59.4, not 120
- title size 72 -> automatic ceiling 79.2, not 118
- subtitle size 40 -> automatic ceiling 44, not 82
- timer size 75 -> automatic ceiling 82.5, not 132

The timer retains its independent reserved band so timer ticks cannot move the body, but the visible `timerOverlay` is content-sized (`max-content`) and centered inside that band. The white border therefore wraps the label/value rather than stretching across the display.

## Verification

After deploying/rebuilding, reload each receiver and run:

```js
JSON.stringify(window.ClassroomDisplayDiagnostics(), null, 2)
```

Expected renderer revision: `single-fit-20260909-3`.

For a scene configured approximately as title 72, subtitle 40, body 54 and timer 75, diagnostics should report fitted sizes no larger than approximately 79.2, 44, 59.4 and 82.5 respectively unless the configured values themselves differ. Long content may be smaller.

Visually verify all of the following on the same real classroom state:

1. title and subtitle are fully inside their bands;
2. body text does not overlap the headings or timer;
3. timer border is a compact centered box around the timer content;
4. timer ticks do not cause the body or headings to resize;
5. 1080p and 4K receivers retain the same logical font sizes.

## Regression guardrail

Do not restore global-cap-only auto-growth. Absolute caps are safety limits, not target sizes. Any future readability work must preserve the configured scene size as the primary design input and must retain compact timer chrome unless a separate timer style is explicitly selected.
