# Display Hard Containment

Renderer revision `single-fit-20260911-5` makes text containment a hard invariant.

Configured title, subtitle, body and timer font sizes are preferences. They may influence the maximum readable size, but they must never cause clipping, overlap, or text extending beyond the assigned logical region. The renderer always shrinks content as far as necessary to fit.

The fitter now validates both layout metrics and the browser's actual rendered text rectangles. This protects against TV Chromium/WebView builds where `scrollWidth`/`scrollHeight` can report a successful fit even though glyph ascent, descent, preserved whitespace, or browser rounding paints outside the box.

The layout module also establishes the natural-height, non-shrinking child and timer-region styles before measuring. This prevents a missing or stale companion stylesheet from reviving legacy constrained children that clip multiline text while reporting misleadingly small layout dimensions.

If quarter-pixel binary search lands on a rounding boundary, the renderer continues reducing the font in 0.25px steps. Pathological content receives a final bounded transform fallback. Readability warnings remain available through `window.ClassroomDisplayDiagnostics()`, but visibility and non-overlap take priority over the requested font size.

The receiver HTML also uses the same `single-fit-20260911-5` cache key for the layout module and stylesheet. Every renderer behavior change must bump this key; otherwise deployed TVs may continue running stale cached layout code after a Hub update.

## Verification

After deployment and receiver reload, run:

```js
JSON.stringify(window.ClassroomDisplayDiagnostics(), null, 2)
```

Expected revision: `single-fit-20260911-5`.

Test scenes should include intentionally excessive configured font sizes, long titles/subtitles, multiline body content, long timer labels, and 720p/1080p/4K/narrow operator viewports. No rendered text rectangle may cross its component region and no component regions may overlap.
