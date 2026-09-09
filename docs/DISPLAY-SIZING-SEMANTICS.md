# Display sizing semantics

Classroom Hub display content uses a fixed 1920x1080 logical canvas on every endpoint. Physical resolution and DPR affect only final stage scaling.

## Four layout components

Title, subtitle, body, and timer are independently bounded logical components. Each component must remain entirely inside its assigned region.

## Auto sizing

Automation display text is intended to be presentation-sized. The configured Text Size is a preferred/default size, not a hard ceiling when auto sizing is enabled. The renderer may grow short content to use the available logical region and must shrink long content to prevent overflow. The same content/state must resolve to the same logical sizes on all displays regardless of physical resolution.

Explicit `autoFit:false` remains fixed-size behavior.

## Invariants

- no component may overflow its logical region
- timer geometry is finalized before body geometry
- routine timer ticks do not trigger global layout
- reconnect/state replay uses the same sizing path as live commands
- physical resolution/DPR never changes the logical fit result
