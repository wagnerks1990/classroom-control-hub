# AI Display Runtime Guardrails

Read `docs/DISPLAY-LAYOUT-CONTRACT.md` before editing display or automation rendering. This supersedes the earlier shrink-only and observer-helper descriptions.

## Authority

- `public/display/layout.mjs` exclusively owns fitted font sizes and the four component regions.
- `public/display/index.html` owns state, media, timer digits, and viewport scaling. It must not add a second fitter.
- Branding must not inject display layout code. `public/shared/display-autofit.js` is a deliberately inert compatibility URL.
- Do not observe style/class mutations, timer text, status badges, or media descendants to trigger global layout.

## Geometry and state

Keep a fixed 1920x1080 logical canvas and one uniform viewport scale. Never multiply fitting dimensions by DPR or use physical screen resolution to choose fonts. Use Hub-served fonts and finish font loading before fitting; report fallback explicitly.

Measure natural-height, non-shrinking children. Child scroll dimensions already include child padding. Check actual browser text bounds as well as boxes: a line-height that is too tight can clip glyphs even when the element box fits.

Automatic fitting grows and shrinks up to component caps, not legacy preferred sizes. Manual sizes still yield to containment. Do not hide an overflow error at a minimum font floor; report content that is too dense to be readable.

Timer geometry is an independently bounded band. Routine ticks may change digits/expiration state only, never font size, label markup, borders, or layout. Keep MM:SS/HH:MM:SS transitions stable. A different layout-relevant state may request one coalesced pass; identical replay and viewport-only scaling must not create repeated passes.

Replay must apply colors, alignment, backgrounds, and option defaults exactly as live commands do. Preserve scheduler eligibility, timer-instance freshness, authentication, media authorization, and Morning Announcements priority independently of this renderer.

## Verification gate

`npm test` includes architectural source guards and unit policy tests; it does not prove visual correctness. The required browser workflow is `.github/workflows/display-browser.yml` with Chromium and Firefox. Run the receiver page through P6/P7 fixtures at 1080p, 4K, HiDPI, 720p, and the narrow captured viewport. Check bounding boxes, glyph ranges, non-overlap, timer stability, replay/reload, long text/labels, and manual/automatic sizing.

Retain screenshots and measurement JSON. Do not weaken a failing visual assertion merely to make CI green. Do not describe source-text regex checks as cross-resolution browser tests. Distinguish local in-memory tests, CI URL-based tests, and actual physical-TV testing in release reports.

Update this file, the layout contract, and the wiki mirror when rendering behavior changes. Never label a deployment permanently fixed based only on a merge or a successful container health endpoint.
