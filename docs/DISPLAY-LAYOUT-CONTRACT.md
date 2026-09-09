# Display Layout Contract

Classroom Control Hub displays render through one resolution-independent logical canvas. This contract exists so a 1920x1080 endpoint, a 3840x2160 endpoint, and other 16:9 displays present the same composition and relative text sizes.

## Logical canvas

The renderer owns a fixed 1920x1080 logical stage. Physical screen resolution and device pixel ratio are diagnostics only and MUST NOT participate in text fitting. The completed logical stage is scaled to the browser CSS viewport with a single uniform scale factor.

This means that the same display state MUST resolve to the same logical font sizes on every endpoint. A 4K display receives more physical pixels, not a different layout calculation.

## Four fitted components

The text renderer has four independently bounded components:

1. Title
2. Subtitle
3. Body
4. Timer

Each component starts at its configured maximum logical font size and may shrink only when necessary to keep all of its content inside its assigned logical region. Content must not exceed or clip outside its region.

The configured size is a maximum, not a resolution-dependent target. For identical content and state, the fitted logical result must be identical across displays.

## Deterministic layout order

Layout is resolved in this order:

1. Apply all incoming state/content.
2. Apply timer style and content.
3. Auto-fit the timer within its logical maximum bounds.
4. Measure the timer's final logical geometry.
5. Reserve body space for a visible bottom timer.
6. Auto-fit title.
7. Auto-fit subtitle.
8. Auto-fit body.
9. Scale the finished 1920x1080 stage to the endpoint viewport.

Only one animation-frame layout pass may be queued at a time. Multiple state changes received in the same browser frame are coalesced into that single final pass.

## Timer behavior

Countdown digit changes do not cause global title/subtitle/body fitting. The visible timer updates once per second. Global layout is requested only when timer geometry can actually change, such as show/hide, style change, new timer state, or viewport change.

## Reload and reconnect behavior

WebSocket state replay must produce the same result as the original live commands. State application must complete before the coalesced layout pass runs. Browser reconnect order must never determine final text size.

## Required regression checks

For the same content/state, compare at minimum:

- 1920x1080 viewport
- 3840x2160 viewport
- identical 16:9 viewport with different devicePixelRatio values
- reload/reconnect during an active timer
- multiline title, subtitle, and body
- long timer label

The logical fitted sizes for title, subtitle, body, and timer must match between equivalent aspect-ratio endpoints. Content must remain fully contained in its logical region.

## AI/contributor invariant

Do not replace the logical-canvas model with physical-resolution-based font calculations. Do not multiply fitting geometry by devicePixelRatio. Do not let periodic timers, heartbeat traffic, or unrelated state updates trigger repeated global auto-fit.
