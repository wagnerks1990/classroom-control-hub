# Automation Display Media

Classroom display receivers use stable direct URLs (`/display/tv1`, `/display/tv2`, and so on). Display enrollment tokens are not part of the normal receiver workflow.

Uploaded media is still protected. The backend issues each connected enabled display a short-lived signed asset token for `/media/*` and `/presentations/*`. A successful automation result does not by itself prove an image rendered; the receiver must also be able to fetch the protected asset.

For linked-class automations, **Use class default display targets** is a persisted event preference and must survive Save/Edit cycles even when the primary action is lighting. Explicit action-specific targets remain authoritative where selected.

## Verification

- Confirm the direct display URL is connected.
- Test a Show Media action and verify the actual receiver renders the selected file.
- Save a linked-class event with class default display targets enabled, reopen it, and verify the checkbox remains enabled.
- Verify explicit cross-domain targets are preserved.


## Test Now and linked-class behavior

`Test Now` executes every action in order and reports the exact action or timer overlay that failed. When a linked class is not scheduled today, manual testing still uses that class as a deterministic context so display text/media/targets and timer rendering can be validated. This exception applies only to manual testing; scheduled execution still requires the linked class and school cycle to match the actual date.

When **Use class default display targets** is enabled, the class display targets apply to every display-domain action in the automation, including display actions added to a lighting-led event and the timer overlay. Lighting targets remain separate.

Alternating-day automations inherit the configured school-cycle anchor. Phase A/B remains the stored phase identity even when the school profile gives those phases friendly labels such as Green Days or Group B Days.


## Display text sizing consistency

Display receivers use role-specific bounded font ranges for title, subtitle, body text, and timer text. Configured sizes are treated as visual targets. Auto-fit only shrinks when content would overflow and does so in predictable increments rather than arbitrary per-pixel results. Timer overlays reserve a deterministic layout band so the same body content does not change size merely because a timer label/value changes height. These rules apply equally to physical displays and controller previews because both use the same display renderer.
