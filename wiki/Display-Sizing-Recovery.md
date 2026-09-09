# Display Sizing Recovery

## Current renderer policy

Renderer revision `single-fit-20260909-3` corrects the September 9 display-size regression.

The TV renderer still uses one fixed 1920x1080 logical canvas. TV resolution and DPR only scale the finished canvas; they do not choose independent font sizes.

Configured title, subtitle, body, and timer sizes are the baseline. Automatic fitting may grow a configured size by no more than 10 percent, up to the component's absolute safety cap, and may shrink whenever content would overflow.

Typical classroom values therefore remain close to what the teacher configured instead of jumping to the previous global maxima:

- title 72 -> at most 79.2
- subtitle 40 -> at most 44
- body 54 -> at most 59.4
- timer 75 -> at most 82.5

The timer continues to reserve its own logical band so timer updates cannot shift lesson content. The visible white timer border is content-sized and centered inside that band, restoring the compact historical timer appearance instead of drawing a box across the display.

## After updating

Rebuild/recreate the Classroom Control Hub service and reload open receiver pages. In the receiver console run:

```js
JSON.stringify(window.ClassroomDisplayDiagnostics(), null, 2)
```

Confirm `revision` is `single-fit-20260909-3`, text regions do not overlap, and the timer border wraps only the timer content.

See `docs/DISPLAY-SIZING-RECOVERY.md` and `docs/DISPLAY-LAYOUT-CONTRACT.md` in the repository for the engineering contract and verification details.
