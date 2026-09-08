from pathlib import Path

path = Path('public/display/index.html')
text = path.read_text()

old = "let ws,timerState={visible:false,running:false,mode:'countdown',durationSeconds:300,remainingSeconds:300},timerTick=null,lastViewportSignature='';"
new = "let ws,timerState={visible:false,running:false,mode:'countdown',durationSeconds:300,remainingSeconds:300},timerTick=null,lastViewportSignature='',fitFrame=null;"
if old not in text:
    raise SystemExit('renderer state marker not found')
text = text.replace(old, new, 1)

marker = "function displayMetrics(){"
scheduler = """function scheduleFit(){
  if(fitFrame!==null)cancelAnimationFrame(fitFrame);
  fitFrame=requestAnimationFrame(()=>{
    fitFrame=null;
    fitAllContent();
  });
}

"""
if scheduler.strip() not in text:
    if marker not in text:
        raise SystemExit('displayMetrics marker not found')
    text = text.replace(marker, scheduler + marker, 1)

# All ordinary renderer layout requests must use the single coalesced scheduler.
text = text.replace('requestAnimationFrame(fitAllContent);', 'scheduleFit();')
text = text.replace("new ResizeObserver(()=>requestAnimationFrame(fitAllContent)).observe(stage)", "new ResizeObserver(()=>scheduleFit()).observe(stage)")

# Keep the identify overlay's dedicated fit frame independent from normal content.
# The generic replacement above does not affect its arrow callback.

path.write_text(text)
