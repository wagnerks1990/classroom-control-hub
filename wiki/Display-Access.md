# Display Access

Enabled classroom receivers use stable URLs such as `/display/tv1` without credentials by default. Unknown or disabled IDs remain rejected. This policy is deliberate so upgrades and cleared browser storage do not unexpectedly take classroom displays offline.

Keep the HTTP deployment restricted to the trusted classroom/admin network. Anyone who can reach the Hub and knows an enabled display ID can connect as that display while URL-only mode is active.

Administrators may opt into per-browser credentials under **Settings → Classroom Display Access**:

1. Create and consume a one-use enrollment link for every enabled display.
2. Verify enrollment coverage.
3. Enable **Require individual display credentials**.

The Hub then rejects missing, revoked, or mismatched credentials. Turning the option off restores stable URL access. Existing credentials can remain stored for later use.

Protected media and presentation files always use short-lived signed asset URLs. `DISPLAY_TOKEN` is only a legacy fallback when credential authentication is required.
