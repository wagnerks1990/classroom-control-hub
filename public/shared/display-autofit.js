"use strict";

(function(){
  if(!location.pathname.startsWith("/display/"))return;

  const MIN_FONT=12;
  // These are logical-pixel safety caps inside the canonical 1920x1080 stage.
  // They are intentionally independent of physical TV resolution/DPR.
  const CAPS=Object.freeze({title:118,subtitle:82,body:120,timer:110});
  let frame=null,running=false;

  function fits(el,box){
    if(!el||!box)return true;
    // scrollWidth/scrollHeight already include the element's own padding. Compare
    // directly to the available logical region. Subtracting the child's padding
    // here made a 100%-wide flex child fail at every font size and collapse to
    // MIN_FONT (the 12px body regression seen on live displays).
    return el.scrollWidth<=Math.max(1,box.clientWidth+1)&&el.scrollHeight<=Math.max(1,box.clientHeight+1);
  }

  function largestFit(el,box,cap,min=MIN_FONT){
    if(!el||!box)return min;
    if(!String(el.textContent||"").trim()){el.style.fontSize=`${min}px`;return min}
    let low=min,high=cap,best=min;
    while(low<=high){
      const mid=Math.floor((low+high)/2);
      el.style.fontSize=`${mid}px`;
      if(fits(el,box)){best=mid;low=mid+1}else high=mid-1;
    }
    el.style.fontSize=`${best}px`;
    return best;
  }

  function timerFits(overlay){
    if(!overlay)return true;
    return overlay.scrollWidth<=1761&&overlay.scrollHeight<=301;
  }

  function fitTimer(overlay){
    if(!overlay||getComputedStyle(overlay).display==='none')return;
    let low=20,high=CAPS.timer,best=20;
    while(low<=high){
      const mid=Math.floor((low+high)/2);
      overlay.style.fontSize=`${mid}px`;
      if(timerFits(overlay)){best=mid;low=mid+1}else high=mid-1;
    }
    overlay.style.fontSize=`${best}px`;
  }

  function reserveBodyForTimer(textLayer,overlay){
    let bottom=105;
    if(overlay&&getComputedStyle(overlay).display!=='none'&&!overlay.classList.contains('timer-top')&&!overlay.classList.contains('timer-center')){
      bottom=Math.max(bottom,35+overlay.offsetHeight+35);
    }
    textLayer.style.bottom=`${Math.min(430,bottom)}px`;
  }

  function layout(){
    frame=null;if(running)return;running=true;
    try{
      const title=document.getElementById('title'),titleRegion=document.getElementById('titleRegion');
      const subtitle=document.getElementById('subtitle'),subtitleRegion=document.getElementById('subtitleRegion');
      const body=document.getElementById('text'),bodyRegion=document.getElementById('textLayer');
      const timer=document.getElementById('timerOverlay');
      if(!title||!subtitle||!body||!bodyRegion)return;

      // One deterministic final pass over the canonical logical canvas.
      // Native renderer state is applied first; this pass only resolves final
      // logical font sizes and never uses viewport resolution or DPR.
      fitTimer(timer);
      reserveBodyForTimer(bodyRegion,timer);
      largestFit(title,titleRegion,CAPS.title,20);
      largestFit(subtitle,subtitleRegion,CAPS.subtitle,16);
      largestFit(body,bodyRegion,CAPS.body,MIN_FONT);

      const stage=document.getElementById('stage');
      if(stage)stage.dataset.autofit=`title:${title.style.fontSize};subtitle:${subtitle.style.fontSize};body:${body.style.fontSize};timer:${timer?.style.fontSize||''}`;
    }finally{running=false}
  }

  function requestLayout(){if(frame!==null||running)return;frame=requestAnimationFrame(layout)}

  const observer=new MutationObserver(records=>{
    if(running)return;
    // Only content/structure changes trigger a final fit. Never observe style or
    // class mutations: doing so caused the fitter to observe its own writes and
    // continuously compete with the native renderer. Ignore routine timer digit
    // changes; timer geometry is fixed for MM:SS/HH:MM:SS and does not need a
    // global body/title/subtitle refit every second.
    const meaningful=records.some(r=>{
      const target=r.target?.nodeType===3?r.target.parentElement:r.target;
      if(target?.id==='timerValue'||target?.closest?.('#timerValue'))return false;
      return r.type==='childList'||r.type==='characterData';
    });
    if(meaningful)requestLayout();
  });

  function start(){
    const stage=document.getElementById('stage');if(!stage){requestAnimationFrame(start);return}
    observer.observe(stage,{subtree:true,childList:true,characterData:true});
    window.addEventListener('resize',requestLayout);
    window.visualViewport?.addEventListener('resize',requestLayout);
    document.addEventListener('fullscreenchange',requestLayout);
    requestLayout();
  }
  start();
})();
