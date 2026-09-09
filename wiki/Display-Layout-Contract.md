# Display Layout Contract

## Single layout owner (2026-09-09)

`public/display/layout.mjs` is the only sizing authority. `public/display/index.html` owns content, timer state, transport, media, and viewport scaling; it calls the engine's `request()` method. `public/display/layout.css` makes fitted text natural-height, non-shrinking children in bounded regions.

The previous inline fitter and branding-injected `display-autofit.js` must not run in parallel. Branding no longer injects layout code. The old helper URL is an inert compatibility stub for cached loaders. Reload already-open receivers after upgrading; executing a new file does not undo an observer already installed by an old page.

## Resolution and fonts

Every receiver uses the same 1920x1080 logical stage. Only the completed stage is scaled with `min(viewportWidth/1920, viewportHeight/1080)`. Physical screen resolution and devicePixelRatio are diagnostics, not inputs to font fitting. A 4K CSS viewport scales the composition by 2; a 1920x1080 CSS viewport at DPR 2 uses scale 1. Both have the same logical layout.

Different aspect ratios use letterboxing, not stretching, cropping, or independently reflowing the logical composition. A narrow operator window therefore displays a smaller complete 16:9 stage; it cannot simultaneously fill that window and preserve the composition's aspect ratio.

The Hub serves a shared Liberation Sans regular/bold font instead of relying on each TV's system-ui font. `tools/prepare-display-fonts.sh` packages fonts already installed by the Dockerfile. There is no runtime CDN dependency. Font loading completes before the first fit; a three-second timeout allows a fallback rather than a permanently blank page. Diagnostics distinguish `ready` from `fallback`. Missing glyphs outside the bundled font's coverage may still require platform fallback.

## Four bounded components

| Component | Logical region | Automatic font cap |
| --- | --- | --- |
| Title | x=72, width=1776, default y=30, height=125 | 118 |
| Subtitle | x=72, width=1776, default y=155, height=100 | 82 |
| Body | x=90, width=1740, default y=270; remaining height | 120 |
| Timer | x=80, width=1760, height=240 when visible | 132 |

Automatic sizing chooses the largest quarter-pixel font that fits the component, up to its cap. The legacy automation size, such as 54, is not an automatic ceiling. Short content grows; longer content shrinks. `autoFit:false` suppresses growth and uses the configured size as a ceiling, but still shrinks on overflow. Containment takes priority over an oversized manual setting.

The timer has its own band rather than a content-dependent height shared with the body. A bottom timer starts at y=805; body content stops at y=781. Without the timer, the body's bottom edge is y=975. A top timer shifts the headings and body down. A centered timer leaves the body in the larger non-overlapping space above or below it. These decisions use logical geometry only.

Fitting measures the child's natural height and width, including its padding and border exactly once. Removing max-height and flex compression from the child prevents hidden clipping from masquerading as a successful fit. Line-height reserves glyph ascent/descent, and preserved whitespace wraps rather than hanging outside the region.

Extremely dense content is not silently clipped at a 12px minimum. The engine may shrink below the readable threshold; exceptionally large blocks are uniformly contained. `fitWarning=content-too-dense` and component status `below-readable-minimum` flag the result. This is a visibility safeguard, not a promise that arbitrary amounts of text can remain readable. Split dense material into separate screens.

## Updates, timers, and state replay

One animation-frame scheduler owns layout. Content/style changes coalesce; a signature of layout-relevant state prevents identical replay or viewport-only changes from re-fitting. There are no MutationObservers watching rendered styles, timer digits, status badges, or media descendants.

A normal timer tick changes only digits and expiration state. It never resets fonts, label markup, borders, classes, or body geometry. The timer is measured with a stable digit envelope, including the bounded numeric range, so hour-format transitions and count-up width changes do not resize other components.

Full state replay uses the same apply functions as live commands, including title/subtitle colors and body alignment/background. Explicit clear resets text options and hides the timer. Separate network commands can arrive in different frames; their final layout must equal an equivalent complete state replay. The browser does not pretend separate network messages are an atomic scene transaction.

## Diagnostics and verification

Run this in a receiver's browser console:

```js
JSON.stringify(window.ClassroomDisplayDiagnostics(), null, 2)
```

The report contains renderer revision, CSS viewport, DPR, stage scale, font-load status, layout pass count, fitted logical sizes, region geometry, and containment warnings. It does not expose credentials or the lesson body. Layout telemetry also accompanies receiver heartbeats.

Expected renderer revision: `single-fit-20260909-2`. A source rebuild may still report application alpha.71 because this is not a new tagged release. Use the renderer revision and commit, not just the application version, to distinguish this correction.

Browser regression tests load the real receiver HTML, layout module, CSS, shared scripts, and fonts. Only transport, the branding API, and the unrelated audio SDK are mocked. Chromium and Firefox CI tests cover P6/P7 samples, 1080p/4K, DPR 1/2, 720p, 1082x1226, reload/reconnect, live commands versus replay, colors, timer ticks/expiry/hour changes, timer positions, long labels, style-only changes, clear, manual sizes, long unbroken words, and dense content. They measure element and text-range bounds and check component overlap. Screenshots and measurement JSON are retained as CI artifacts.

```bash
bash tools/prepare-display-fonts.sh
python3 -m venv /tmp/display-tests
/tmp/display-tests/bin/pip install -r test/browser/requirements.txt
/tmp/display-tests/bin/python -m playwright install --with-deps chromium firefox
DISPLAY_TEST_BROWSER=chromium /tmp/display-tests/bin/python -m unittest discover -s test/browser -v
DISPLAY_TEST_BROWSER=firefox /tmp/display-tests/bin/python -m unittest discover -s test/browser -v
npm test
```

For restricted offline development only, `DISPLAY_TEST_INLINE=1` loads identical source/CSS/font bytes into an in-memory document, with a fixture location. CI must run the normal URL/asset-loading path. Neither mode is evidence of testing on physical classroom TVs.

## Deployment

Take an operational backup, update the source checkout, and rebuild the main `classroom-hub` service so the font assets are packaged. Recreate that service, check health, and reload all receivers. No automation payload edits, database migration, or device re-enrollment is required. Confirm the renderer revision and `fontStatus:ready`, then compare the same state on the actual 1080p and 4K receivers.

## Receiver input safety (PR #27 merge review)

The receiver validates media URLs in `public/display/security.mjs` before touching the DOM. Only HTTP(S) URLs without embedded credentials are allowed; malformed URLs, executable schemes, control characters and excessive nested document viewers are rejected without replacing the current media. Protected same-origin media/presentation paths receive the asset token; external hosts never receive it. External signage frames are sandboxed without same-origin access, top navigation or popup permissions. Sites requiring cookies/storage or popup login may not work in this isolated frame; use a purpose-built embeddable signage URL. Local built-in document/Ant Media viewers retain their existing behavior.

Music Assistant browser connections may use only this Hub's `/music-assistant/sendspin-proxy` WebSocket endpoint, matching its host, port and HTTP/TLS-derived socket scheme, with one 32-character base64url ticket. Reject arbitrary socket hosts, paths, credentials and extra parameters. The final destination is rebuilt from the trusted Hub origin and fixed path.

Identify overlays last 1–30 seconds (8 seconds by default). Repeated identification replaces the previous timeout/frame; clearing the display cancels both. These changes must not trigger another title/subtitle/body/timer layout engine. Unit policy tests and real-browser rejection/lifecycle tests accompany the rendering tests.
