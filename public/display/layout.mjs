// One owner for title, subtitle, body, timer geometry and fitted font sizes.
// All measurements are untransformed CSS layout pixels on the 1920x1080 stage.
export const LAYOUT_REVISION = 'single-fit-20260909-4';
export const FONT_CAPS = Object.freeze({title:118, subtitle:82, body:120, timer:132});
// Auto-fit may improve readability slightly, but configured scene sizes remain the
// visual baseline. The renderer may always shrink below that preference to keep
// every rendered glyph inside its assigned region.
export const AUTO_GROW_FACTOR = 1.10;
const READABLE_MIN = 12;
const finite = (value, fallback) => value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value);
export const bounded = (value, fallback, min, max) => Math.max(min, Math.min(max, finite(value, fallback)));
function autoCap(value, fallback, globalCap) {
  const configured = bounded(value, fallback, 1, 2000);
  return Math.min(globalCap, configured * AUTO_GROW_FACTOR);
}

function available(box) {
  const s = getComputedStyle(box);
  return {
    width: box.clientWidth - parseFloat(s.paddingLeft || 0) - parseFloat(s.paddingRight || 0),
    height: box.clientHeight - parseFloat(s.paddingTop || 0) - parseFloat(s.paddingBottom || 0)
  };
}
function renderedContained(el, box) {
  // Unit tests and non-browser callers may provide geometry-only stubs. In a real
  // receiver Chromium/WebView always provides DOM rect APIs; when they are absent,
  // the scroll/offset containment checks in fits() remain authoritative.
  if (typeof box?.getBoundingClientRect !== 'function' || typeof el?.getBoundingClientRect !== 'function' || typeof document === 'undefined') return true;
  const br = box.getBoundingClientRect();
  const tolerance = 0.75;
  const inside = r => r.left >= br.left - tolerance && r.top >= br.top - tolerance &&
    r.right <= br.right + tolerance && r.bottom <= br.bottom + tolerance;
  const er = el.getBoundingClientRect();
  if (!inside(er)) return false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent || !walker.currentNode.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0 && !inside(r)) return false;
  }
  return true;
}
export function fits(el, box) {
  const a = available(box);
  return a.width > 0 && a.height > 0 &&
    Math.max(el.scrollWidth, el.offsetWidth) <= a.width + 0.5 &&
    Math.max(el.scrollHeight, el.offsetHeight) <= a.height + 0.5 &&
    renderedContained(el, box);
}

// Binary-search the largest usable size, then validate the actual painted text.
// Scroll dimensions alone are insufficient on some Chromium/TV WebView builds:
// glyph ascent/descent and preserved whitespace can paint beyond the measured box.
export function fitElement(el, box, cap) {
  cap = bounded(cap, 64, 1, 2000);
  el.style.transform = '';
  if (!el.textContent.trim()) {
    el.style.fontSize = '12px';
    return {fontSize:12, scale:1, status:'empty'};
  }
  if (box.clientWidth <= 0 || box.clientHeight <= 0) return {status:'unmeasurable'};
  let low = 4, high = Math.floor(cap * 4), best = 4;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    el.style.fontSize = `${mid / 4}px`;
    if (fits(el, box)) { best = mid; low = mid + 1; } else { high = mid - 1; }
  }
  let fontSize = best / 4;
  el.style.fontSize = `${fontSize}px`;

  // Hard containment fallback. Quarter-pixel search can still land on a browser
  // rounding boundary; walk downward until the painted text is unquestionably
  // contained. A configured font size never overrides this invariant.
  let guard = 0;
  while (!fits(el, box) && fontSize > 1 && guard++ < 256) {
    fontSize = Math.max(1, fontSize - 0.25);
    el.style.fontSize = `${fontSize}px`;
  }

  let scale = 1;
  if (!fits(el, box)) {
    const a = available(box);
    scale = Math.min(1, a.width / Math.max(1, el.scrollWidth, el.offsetWidth),
      a.height / Math.max(1, el.scrollHeight, el.offsetHeight)) * 0.99;
    const align = getComputedStyle(box).alignItems;
    el.style.transformOrigin = `center ${align === 'flex-start' ? 'top' : align === 'flex-end' ? 'bottom' : 'center'}`;
    el.style.transform = `scale(${scale})`;
    // Reduce one final time if transformed paint still touches the region edge.
    while (!renderedContained(el, box) && scale > 0.05 && guard++ < 512) {
      scale *= 0.99;
      el.style.transform = `scale(${scale})`;
    }
  }
  return {fontSize, scale, status:fontSize * scale < READABLE_MIN ? 'below-readable-minimum' : 'fit'};
}

export function createDisplayLayout(nodes, getState) {
  const {stage, title, titleRegion, subtitle, subtitleRegion, text, textLayer,
    timerRegion, timerOverlay, timerLabel, timerValue} = nodes;
  let frame = null, previousKey = '', fontEpoch = 0, passCount = 0;
  let fontStatus = 'loading', disposed = false, report = {};
  stage.dataset.renderer = LAYOUT_REVISION;
  stage.dataset.fontStatus = fontStatus;

  function region(el, top, height) {
    el.style.top = `${top}px`;
    el.style.bottom = 'auto';
    el.style.height = `${Math.max(1, height)}px`;
  }
  function fitTimer(state) {
    timerRegion.hidden = !state.visible;
    if (!state.visible) return {fontSize:0, scale:1, status:'hidden'};
    const actual = timerValue.textContent;
    timerValue.textContent = '8888888888888:88:88';
    timerOverlay.style.width = 'max-content';
    timerOverlay.style.maxWidth = '100%';
    timerOverlay.style.borderWidth = `${bounded(state.borderWidth, 4, 0, 24)}px`;
    const cap = state.autoFit === false
      ? bounded(state.fontSize, 64, 1, 400)
      : autoCap(state.fontSize, 64, FONT_CAPS.timer);
    const result = fitElement(timerOverlay, timerRegion, cap);
    timerValue.textContent = actual;
    // Revalidate the real timer content after restoring its current digits.
    if (!fits(timerOverlay, timerRegion)) return fitElement(timerOverlay, timerRegion, result.fontSize);
    return result;
  }
  function geometry(timer) {
    let titleTop = 30, bodyTop = 270, bodyEnd = 975;
    if (timer.visible) {
      const position = ['top','center','bottom'].includes(timer.position) ? timer.position : 'bottom';
      const top = position === 'top' ? 35 : position === 'center' ? 420 : 805;
      region(timerRegion, top, 240);
      if (position === 'top') {
        titleTop = top + 240 + 24;
        bodyTop = titleTop + 240;
      } else if (position === 'center') {
        const before = top - 24 - bodyTop, after = bodyEnd - (top + 240 + 24);
        if (after >= before) bodyTop = top + 240 + 24;
        else bodyEnd = top - 24;
      } else bodyEnd = top - 24;
    }
    region(titleRegion, titleTop, 125);
    region(subtitleRegion, titleTop + 125, 100);
    region(textLayer, bodyTop, bodyEnd - bodyTop);
  }
  function run() {
    frame = null;
    if (disposed || fontStatus === 'loading') return;
    const state = getState(), timer = state.timerState || {};
    const key = JSON.stringify([title.textContent, subtitle.textContent, text.textContent,
      state.titleOptions, state.subtitleOptions, state.textOptions,
      !!timer.visible, timer.label || '', timer.position || 'bottom', timer.fontSize,
      timer.autoFit, timer.borderWidth, fontEpoch]);
    if (key === previousKey) return;
    geometry(timer);
    const timerFit = fitTimer(timer);
    const options = [state.titleOptions || {}, state.subtitleOptions || {}, state.textOptions || {}];
    const components = {timer:timerFit};
    [[title,titleRegion,'title',92],[subtitle,subtitleRegion,'subtitle',44],[text,textLayer,'body',64]]
      .forEach(([el, box, name, fallback], i) => {
        const o = options[i];
        const cap = o.autoFit === false
          ? bounded(o.size, fallback, 1, 2000)
          : autoCap(o.size, fallback, FONT_CAPS[name]);
        components[name] = fitElement(el, box, cap);
      });
    previousKey = key;
    passCount++;
    for (const [name, el] of Object.entries({title:titleRegion,subtitle:subtitleRegion,body:textLayer,timer:timerRegion})) {
      components[name].region = {x:el.offsetLeft, y:el.offsetTop, width:el.clientWidth, height:el.clientHeight};
    }
    report = {revision:LAYOUT_REVISION, passCount, fontStatus, components};
    stage.dataset.layout = ['title','subtitle','body','timer'].map(n => `${n}:${components[n].fontSize || 0}px`).join(';');
    stage.dataset.layoutPasses = String(passCount);
    stage.dataset.fitWarning = Object.values(components).some(c => c.status === 'below-readable-minimum') ? 'content-too-dense' : '';
  }
  function request() {
    if (!disposed && frame === null) frame = requestAnimationFrame(run);
  }
  function fontsChanged() { fontEpoch++; previousKey = ''; request(); }
  function finishFonts() {
    if (disposed) return;
    fontStatus = document.fonts?.check('16px "Classroom Display"') ? 'ready' : 'fallback';
    stage.dataset.fontStatus = fontStatus;
    fontsChanged();
  }
  const fontTimeout = setTimeout(finishFonts, 3000);
  if (document.fonts) {
    Promise.all([document.fonts.load('16px "Classroom Display"'), document.fonts.load('700 16px "Classroom Display"')])
      .then(() => document.fonts.ready).then(finishFonts, finishFonts).finally(() => clearTimeout(fontTimeout));
    document.fonts.addEventListener?.('loadingdone', fontsChanged);
  } else finishFonts();
  request();
  return {
    request,
    snapshot:() => ({...report, revision:LAYOUT_REVISION, fontStatus, passCount}),
    dispose() {
      disposed = true; clearTimeout(fontTimeout);
      if (frame !== null) cancelAnimationFrame(frame);
      document.fonts?.removeEventListener?.('loadingdone', fontsChanged);
    }
  };
}
