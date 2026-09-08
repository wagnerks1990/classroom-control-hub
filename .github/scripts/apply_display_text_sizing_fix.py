from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

path = Path('public/display/index.html')
text = path.read_text()

text = replace_once(
    text,
    "const LOGICAL_WIDTH=1920,LOGICAL_HEIGHT=1080,MIN_FONT=12,DISPLAY_BUILD='1.0.0-alpha.70';",
    "const LOGICAL_WIDTH=1920,LOGICAL_HEIGHT=1080,MIN_FONT=12,DISPLAY_BUILD='1.0.0-alpha.70';\nconst FONT_LIMITS={title:{min:52,max:96,step:4},subtitle:{min:28,max:52,step:2},text:{min:34,max:64,step:2},timer:{min:44,max:80,step:2}};",
    'font limits'
)

old_fit = '''function fitText(el,box,maxSize,minSize=MIN_FONT){
  if(!el||!box||!el.textContent){return}
  maxSize=Math.max(minSize,Math.min(2000,Number(maxSize)||minSize));
  let low=minSize,high=maxSize,best=minSize;
  el.style.fontSize=`${maxSize}px`;
  if(elementFits(el,box)){return}
  while(low<=high){
    const mid=Math.floor((low+high)/2);
    el.style.fontSize=`${mid}px`;
    if(elementFits(el,box)){best=mid;low=mid+1}else high=mid-1;
  }
  el.style.fontSize=`${best}px`;
}'''
new_fit = '''function clampFontTarget(value,role='text'){
  const limits=FONT_LIMITS[role]||{min:MIN_FONT,max:2000,step:1};
  return Math.max(limits.min,Math.min(limits.max,Number(value)||limits.min));
}
function fitText(el,box,maxSize,minSize=MIN_FONT,step=2){
  if(!el||!box||!el.textContent){return}
  maxSize=Math.max(minSize,Math.min(2000,Number(maxSize)||minSize));
  step=Math.max(1,Math.round(Number(step)||1));
  el.style.fontSize=`${maxSize}px`;
  if(elementFits(el,box)){return}
  let size=maxSize;
  while(size>minSize){
    size=Math.max(minSize,size-step);
    el.style.fontSize=`${size}px`;
    if(elementFits(el,box))return;
  }
  el.style.fontSize=`${minSize}px`;
}'''
text = replace_once(text, old_fit, new_fit, 'predictable auto fit')

old_reserve = '''function reserveTextForTimer(){
  let bottom=105;
  if(timerState.visible&&timerState.position!=='top'&&timerState.position!=='center'&&timerOverlay.style.display!=='none'){
    bottom=Math.max(bottom,35+timerOverlay.offsetHeight+35);
  }
  textLayer.style.bottom=`${Math.min(430,bottom)}px`;
}'''
new_reserve = '''function reserveTextForTimer(){
  let bottom=105;
  if(timerState.visible&&timerState.position!=='top'&&timerState.position!=='center'){
    // Reserve a deterministic timer band based on configured styling rather
    // than the current measured label/value height. This prevents body text
    // from changing size as the timer value or label wraps between renders.
    const timerFont=clampFontTarget(timerState.fontSize??64,'timer');
    const timerBand=Math.min(240,Math.max(130,Math.round(timerFont*1.9)));
    bottom=Math.max(bottom,35+timerBand+35);
  }
  textLayer.style.bottom=`${Math.min(430,bottom)}px`;
}'''
text = replace_once(text, old_reserve, new_reserve, 'stable timer reservation')

old_fit_all = '''function fitAllContent(){
  reserveTextForTimer();
  if(titleOptions.autoFit!==false)fitText(title,titleRegion,titleOptions.size||92);else title.style.fontSize=`${Math.max(MIN_FONT,Number(titleOptions.size||92))}px`;
  if(subtitleOptions.autoFit!==false)fitText(subtitle,subtitleRegion,subtitleOptions.size||44);else subtitle.style.fontSize=`${Math.max(MIN_FONT,Number(subtitleOptions.size||44))}px`;
  if(textOptions.autoFit!==false)fitText(text,textLayer,textOptions.size||64);else text.style.fontSize=`${Math.max(MIN_FONT,Number(textOptions.size||64))}px`;
  if(timerState.visible){
    const max=timerState.fontSize??64;
    fitText(timerValue,timerOverlay,max,20);
  }
}'''
new_fit_all = '''function fitAllContent(){
  reserveTextForTimer();
  const titleSize=clampFontTarget(titleOptions.size||92,'title');
  const subtitleSize=clampFontTarget(subtitleOptions.size||44,'subtitle');
  const bodySize=clampFontTarget(textOptions.size||64,'text');
  if(titleOptions.autoFit!==false)fitText(title,titleRegion,titleSize,FONT_LIMITS.title.min,FONT_LIMITS.title.step);else title.style.fontSize=`${titleSize}px`;
  if(subtitleOptions.autoFit!==false)fitText(subtitle,subtitleRegion,subtitleSize,FONT_LIMITS.subtitle.min,FONT_LIMITS.subtitle.step);else subtitle.style.fontSize=`${subtitleSize}px`;
  if(textOptions.autoFit!==false)fitText(text,textLayer,bodySize,FONT_LIMITS.text.min,FONT_LIMITS.text.step);else text.style.fontSize=`${bodySize}px`;
  if(timerState.visible){
    const timerSize=clampFontTarget(timerState.fontSize??64,'timer');
    fitText(timerValue,timerOverlay,timerSize,FONT_LIMITS.timer.min,FONT_LIMITS.timer.step);
  }
}'''
text = replace_once(text, old_fit_all, new_fit_all, 'role bounded sizing')

path.write_text(text)

Path('test/display-text-sizing.test.js').write_text(r'''"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const display=fs.readFileSync("public/display/index.html","utf8");

test("display text uses role-specific bounded font ranges",()=>{
  assert.match(display,/FONT_LIMITS=\{title:\{min:52,max:96,step:4\},subtitle:\{min:28,max:52,step:2\},text:\{min:34,max:64,step:2\},timer:\{min:44,max:80,step:2\}\}/);
  assert.match(display,/clampFontTarget\(titleOptions\.size\|\|92,'title'\)/);
  assert.match(display,/clampFontTarget\(textOptions\.size\|\|64,'text'\)/);
});

test("autofit shrinks in predictable steps instead of arbitrary pixel search",()=>{
  assert.match(display,/while\(size>minSize\)/);
  assert.match(display,/size=Math\.max\(minSize,size-step\)/);
  assert.doesNotMatch(display,/let low=minSize,high=maxSize,best=minSize/);
});

test("timer reservation is deterministic",()=>{
  assert.match(display,/const timerBand=Math\.min\(240,Math\.max\(130,Math\.round\(timerFont\*1\.9\)\)\)/);
  assert.doesNotMatch(display,/timerOverlay\.offsetHeight/);
});
''')

for doc_path in ('docs/AI-CONTEXT.md','wiki/Automation-Display-Media.md'):
    p=Path(doc_path)
    s=p.read_text()
    marker='## Display text sizing consistency'
    if marker not in s:
        s += '''\n\n## Display text sizing consistency\n\nDisplay receivers use role-specific bounded font ranges for title, subtitle, body text, and timer text. Configured sizes are treated as visual targets. Auto-fit only shrinks when content would overflow and does so in predictable increments rather than arbitrary per-pixel results. Timer overlays reserve a deterministic layout band so the same body content does not change size merely because a timer label/value changes height. These rules apply equally to physical displays and controller previews because both use the same display renderer.\n'''
        p.write_text(s)
