# Automation Display Media and Class Targets

## Direct display media access

Classroom displays use stable direct URLs such as `/display/tv1` and `/display/tv2`. Per-browser display enrollment is retired.

Uploaded media remains protected behind signed, short-lived asset URLs. A connected enabled display receives a device-bound HMAC asset token from the backend and uses that token when loading `/media/*` and `/presentations/*` resources. Direct display mode must not depend on the retired display-enrollment policy for those signed asset requests.

A scheduled event can therefore complete at the automation layer while a display still fails to render media if the browser's asset request is rejected. When troubleshooting a media action, validate both the automation execution and the display's subsequent `/media/...` request.

## Linked class default display targets

`Use class default display targets` is a persisted event preference. It must not be silently cleared merely because the primary event action is lighting or another non-display domain.

For linked-class events, the preference is retained so display-domain actions and future cross-domain target resolution can use the class's configured display defaults. Explicit per-action display targets continue to take precedence where configured.

## Test checklist

1. Open the target display with its direct URL and confirm it reports connected.
2. Run an automation with `Display -> Show Image / Video / Document`.
3. Confirm the selected media loads on the display, not merely that the automation reports `Completed`.
4. Edit a linked-class event, enable `Use class default display targets`, save it, reopen the event, and confirm the checkbox remains enabled.
5. Verify explicit cross-domain action targets remain unchanged after save/reload.
