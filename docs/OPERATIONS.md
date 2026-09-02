# Operations

## Daily operating model

Classroom Control Hub continuously reconciles configured classroom state with schedules, connected displays, integrations, and priority content. Operators should normally allow the scheduler to maintain the current classroom state and use manual controls for testing, exceptions, or immediate intervention.

## Displays

Display clients should remain connected in kiosk/browser mode and identify themselves using stable IDs. If a display reconnects, the server should restore the current intended content rather than relying on stale client-side state.

If a display is offline:

1. verify network connectivity and browser/kiosk process;
2. confirm the display ID is correct;
3. confirm WebSocket/reverse-proxy connectivity;
4. reconnect/reload the display;
5. verify it converges to the currently scheduled content.

## Automations

Scheduled automations may be class-linked or time-based. Manual `Run Now`/`Test Now` actions are useful for validation but must still obey system priority locks.

When an automation is linked to multiple classes, runtime class resolution should select the occurrence that is actually active rather than blindly selecting the first configured class.

### Timers

Linked-class timers use the active occurrence's actual end time. Transition pseudo-classes are standalone timer endpoints. Continuation chaining must match the same underlying class/period and only extend into an explicitly recognized continuation/Bison period.

Adjacent unrelated regular periods do not chain simply because they are close together in time.

## Morning Announcements

Morning Announcements are a hard-priority display/audio mode.

Automatic flow:

```text
Live Watch detects stream LIVE
        ↓
Enter announcement priority state
        ↓
Clear announcement target displays
        ↓
Pause Background Music
        ↓
Play stream fullscreen
        ↓
Apply saved announcement volume
        ↓
Maintain priority lock while live
```

Manual `Play Announcements` enters the same priority state.

While announcements are active:

- target displays cannot be overwritten by normal automations;
- background music remains paused;
- scheduled conflicting automations are deferred;
- manual automation execution is blocked from replacing HerdTV/announcement content.

When announcements end or are manually stopped:

```text
Clear announcement content
        ↓
Reconcile/defer-to-current automation state
        ↓
Release announcement priority lock
        ↓
Resume Background Music if schedule requires it
```

The stream detector and stream player are separate concerns. A manual player working does not prove Live Watch detection works; diagnostics should report which probe determined LIVE/OFFLINE.

## Announcement volume

Announcement volume is persistent and independent from Background Music. Reload/unmute recovery must reapply the saved announcement volume because embedded media players may recreate their internal video element.

## Background Music

Background Music follows its own schedule. Normal visual/silent automation should not interrupt it.

It pauses for priority audio and resumes after priority audio is released. Recovery logic should compare scheduler intent with the actual Music Assistant player/group state so it can self-heal after player reconnects or unexpected idle states.

## Calendar exceptions

School calendar rules are evaluated before normal automation execution. A deployment may define no-school dates, remote days, half days, and delayed starts.

No-school days normally suppress scheduled classroom operation. Remote days may suppress physical classroom schedules while leaving manual administrative controls available.

## Controller hard refresh

After frontend updates, use a hard refresh (`Ctrl+Shift+R` in common desktop browsers) if the browser continues to serve cached controller assets.

Display clients should normally reconnect automatically, but version mismatch/reload logic must be monitored after releases.

## Logs

Useful commands:

```bash
cd /opt/classroom-control-hub
docker compose ps
docker compose logs --tail=150
docker compose logs -f classroom-control-hub
```

Do not publish logs publicly until they have been checked for credentials, internal addresses, user information, and diagnostic payloads.
