# Android / Google TV Support Matrix

This document records hardware/firmware behavior observed during physical validation. A device is not considered fully supported until all required rows have been tested on that exact model/build.

## Onn 4K Streaming Device — Android 14

Status: **Experimental / active validation**

Observed on 2026-09-09:

| Capability | Result | Notes |
| --- | --- | --- |
| Wireless ADB pairing | Pass | Pairing-code flow works through Classroom Hub GUI. |
| Pairing authorization after reboot | Pass | Device still listed the Hub as paired after reboot. |
| Device identification | Pass | Manufacturer `onn`, model `onn 4K Streaming Device`, Android 14. |
| Home / Back / OK | Pass | Remote key actions verified from Managed Displays. |
| Volume control | Pass | Volume actions verified. |
| Screenshot | Pass | PNG screenshot retrieval verified. |
| Sleep / Wake | Pass | Android endpoint sleep and wake verified. |
| Reboot command | Pass | Device rebooted successfully. Reboot API must treat transport loss as expected. |
| Wireless Debugging toggle after reboot | Fail / firmware behavior | The device disabled Wireless Debugging after reboot while preserving pairing authorization. |
| Secure ADB port after reboot | Dynamic | Port changed after reboot. |
| Reconnect after manually re-enabling Wireless Debugging | Pass | Managed Displays Status recovered the device without re-pairing. |
| Persistent ADB agent bootstrap | Pending | New opt-in `WRITE_SECURE_SETTINGS` boot-restoration path requires physical test. |
| Display Agent install | Pending | Requires current test APK staging. |
| Kiosk display URL | Pending | Requires agent install/configuration. |
| Auto-launch after boot | Pending | Requires agent install/configuration. |
| Fixed ADB port after reboot | Pending | Persistent ADB bootstrap targets port 5555; needs cold-reboot validation. |
| HDMI-CEC physical panel power | Not tested | Must be validated separately from Android sleep/wake. |

## Promotion criteria

Promote a hardware/build combination to **Supported** only after:

1. Enrollment succeeds from a clean or documented starting state.
2. Routine remote controls, screenshot and status pass.
3. Reboot and unattended recovery behavior are understood and documented.
4. Display Agent installs, configures, launches and returns after reboot.
5. Persistent ADB behavior is explicitly marked supported, unsupported, or not required.
6. HDMI-CEC behavior is recorded if physical panel power is advertised.
7. The exact firmware/build fingerprint is captured in the managed device inventory or test record.
