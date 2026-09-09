# Display Layout Contract

Classroom Control Hub renders every classroom display on the same fixed **1920x1080 logical canvas**. Physical resolution and device pixel ratio do not change text fitting; the finished logical stage is uniformly scaled to the endpoint viewport.

The display has four independently bounded auto-fit components: **Title, Subtitle, Body, and Timer**. Each begins at its configured maximum logical font size and shrinks only when necessary to remain fully inside its region.

For identical content and state, a 1920x1080 TV and a 3840x2160 TV must resolve to the same logical font sizes. A 4K panel gets more physical pixels, not a different layout.

Layout order is deterministic: apply state, fit timer, measure final timer geometry, reserve body space, fit title, fit subtitle, fit body, then scale the finished stage. Only one layout pass may be queued per animation frame.

Routine one-second timer digit updates do not trigger global text fitting. Reloads and WebSocket reconnects must produce the same fitted result as the original live automation.

Contributor invariant: never base text fitting on physical screen resolution or devicePixelRatio, and never let heartbeat/timer traffic repeatedly trigger global auto-fit.
