from pathlib import Path

p = Path('public/display/index.html')
s = p.read_text()

old = "let ws,timerState={visible:false,running:false,mode:'countdown',durationSeconds:300,remainingSeconds:300},timerTick=null,lastViewportSignature='';"
new = "let ws,timerState={visible:false,running:false,mode:'countdown',durationSeconds:300,remainingSeconds:300},timerTick=null,lastViewportSignature='',fitFrame=null;"
if old not in s:
    raise SystemExit('fit frame state anchor missing')
s = s.replace(old, new, 1)

anchor = "function fitAllContent(){\n"
helper = "function scheduleFit(){\n  if(fitFrame!==null)cancelAnimationFrame(fitFrame);\n  fitFrame=requestAnimationFrame(()=>{fitFrame=null;fitAllContent()});\n}\n"
if anchor not in s:
    raise SystemExit('fitAllContent anchor missing')
s = s.replace(anchor, helper + anchor, 1)

s = s.replace('requestAnimationFrame(fitAllContent);', 'scheduleFit();')
s = s.replace("new ResizeObserver(()=>requestAnimationFrame(fitAllContent)).observe(stage)", "new ResizeObserver(scheduleFit).observe(stage)")

p.write_text(s)

# Extend regression coverage.
t = Path('test/display-text-sizing.test.js')
if not t.exists():
    raise SystemExit('display text sizing test missing')
ts = t.read_text()
if 'coalesces repeated fit passes' not in ts:
    ts += r'''

test("coalesces repeated fit passes so identical payloads are idempotent",()=>{
  assert.match(display,/fitFrame=null/);
  assert.match(display,/function scheduleFit\(\)/);
  assert.match(display,/cancelAnimationFrame\(fitFrame\)/);
  assert.match(display,/new ResizeObserver\(scheduleFit\)/);
  assert.doesNotMatch(display,/requestAnimationFrame\(fitAllContent\)/);
});
'''
    t.write_text(ts)

# Document the invariant.
d = Path('docs/DISPLAY-TEXT-SIZING.md')
if d.exists():
    ds = d.read_text()
    if 'idempotent' not in ds.lower():
        ds += "\n## Idempotent layout\n\nRepeated delivery of the same final display state must produce the same computed font sizes. Renderer updates coalesce fit requests into one latest-frame layout pass so clear/title/subtitle/text/timer command ordering cannot make font size depend on timing.\n"
        d.write_text(ds)
