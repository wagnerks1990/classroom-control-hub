# Automation Display Media

Classroom display receivers use stable direct URLs (`/display/tv1`, `/display/tv2`, and so on). Display enrollment tokens are not part of the normal receiver workflow.

Uploaded media is still protected. The backend issues each connected enabled display a short-lived signed asset token for `/media/*` and `/presentations/*`. A successful automation result does not by itself prove an image rendered; the receiver must also be able to fetch the protected asset.

For linked-class automations, **Use class default display targets** is a persisted event preference and must survive Save/Edit cycles even when the primary action is lighting. Explicit action-specific targets remain authoritative where selected.

## Verification

- Confirm the direct display URL is connected.
- Test a Show Media action and verify the actual receiver renders the selected file.
- Save a linked-class event with class default display targets enabled, reopen it, and verify the checkbox remains enabled.
- Verify explicit cross-domain targets are preserved.
