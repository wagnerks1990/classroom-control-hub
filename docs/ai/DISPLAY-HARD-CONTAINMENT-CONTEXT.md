# AI Context: Display Hard Containment

Renderer revision `single-fit-20260911-5` defines a non-negotiable containment rule: configured font sizes are preferences/maxima, not guarantees. Title, subtitle, body and timer text must shrink until every actual rendered text rectangle is inside its assigned region.

Do not regress to trusting only `scrollWidth`/`scrollHeight`. TV Chromium/WebView builds can paint glyphs outside measured boxes because of ascent/descent, preserved whitespace, or rounding. Keep painted-range validation and the bounded fallback shrink/scale path.

Do not make natural-height/non-shrinking fitted children or timer-region geometry depend only on the companion stylesheet. The layout module must establish those critical styles before measurement so stale or failed CSS cannot make clipped children appear to fit.

Do not make `autoFit:false` mean "allow overflow". Manual sizing may suppress growth, but containment still wins.

Any behavioral change to display sizing must bump the receiver's layout module/CSS cache key and `LAYOUT_REVISION` together. A source update without a new asset key can leave deployed TVs running stale cached renderer code.

Verification must include extreme configured sizes, multiline text, long timer labels, reload/reconnect, and multiple viewport sizes. Browser tests should assert painted glyph containment as well as component-region non-overlap.
