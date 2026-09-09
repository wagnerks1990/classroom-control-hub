"use strict";

(function(){
  if(!location.pathname.startsWith("/display/"))return;

  const MIN_FONT=12;
  const CAPS=Object.freeze({title:118,subtitle:82,body:190,timer:132});
  let frame=null,running=false;

  function fits(el,box){
    if(!el||!box)return true;
    const cs=getComputedStyle(el);
    const padX=parseFloat(cs.paddingLeft||0)+parseFloat(cs.paddingRight||0);
    const padY=parseFloat(cs.paddingTop||0)+parseFloat(cs.paddingBottom||0);
    return el.scrollWidth<=Math.max(1,box.clientWidth-padX+1)&&el.scrollHeight<=Math.max(1,box.clientHeight-padY+1);
  }

  function largestFit(el,box,cap,min=MIN_FONT){
    if(!el||!box||!el.textContent.trim())return;
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
    const cs=getComputedStyle(overlay);
    const px=parseFloat(cs.paddingLeft||0)+parseFloat(cs.paddingRight||0)+parseFloat(cs.borderLeftWidth||0)+parseFloat(cs.borderRightWidth||0);
    const py=parseFloat(cs.paddingTop||0)+parseFloat(cs.paddingBottom||0)+parseFloat(cs.borderTopWidth||0)+parseFloat(cs.borderBottomWidth||0);
    return overlay.scrollWidth<=Math.max(1,1760-px+1)&&overlay.scrollHeight<=Math.max(1,300-py+1);
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

      // Resolve the four logical components only against the canonical 1920x1080
      // stage. Physical resolution/DPR never enters these calculations.
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
    if(records.some(r=>r.type==='childList'||r.type==='characterData'||(r.type==='attributes'&&['style','class'].includes(r.attributeName))))requestLayout();
  });

  function start(){
    const stage=document.getElementById('stage');if(!stage){requestAnimationFrame(start);return}
    observer.observe(stage,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});
    window.addEventListener('resize',requestLayout);
    window.visualViewport?.addEventListener('resize',requestLayout);
    document.addEventListener('fullscreenchange',requestLayout);
    requestLayout();
  }
  start();
})();
