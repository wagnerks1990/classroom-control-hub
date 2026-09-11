# Display Hard Containment

Renderer `single-fit-20260911-5` treats configured font sizes as preferences, never as permission to overflow.

Title, subtitle, body and timer content are automatically reduced until the browser's actual rendered text rectangles fit inside their assigned regions. This applies even when an automation or operator sends a very large font size.

The renderer checks both normal layout dimensions and painted glyph rectangles because some TV Chromium/WebView builds can under-report overflow through scroll measurements alone. A final bounded scaling fallback protects exceptionally dense content.

The renderer now establishes its containment-critical structural styles before measurement, so stale or unavailable layout CSS cannot reactivate legacy max-height/flex shrinking and partially clip multiline titles or body text.

After updating the Hub, reload receiver pages and verify `window.ClassroomDisplayDiagnostics().revision` reports `single-fit-20260911-5`. The receiver asset cache key is intentionally bumped with each layout behavior change so TVs do not keep stale renderer code.
