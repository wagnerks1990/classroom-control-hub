"use strict";

(function installManualMediaVolumeControl(){
  if(location.pathname!=="/controller/display.html")return;

  function el(id){return document.getElementById(id)}
  function install(){
    const muted=el("videoMuted"),opacity=el("mediaOpacity");
    if(!muted||!opacity||el("mediaVolume"))return;

    const wrap=document.createElement("div");
    wrap.className="grid2";
    wrap.style.marginTop="8px";
    wrap.innerHTML=`
      <label>Playback Volume
        <div class="toolbar" style="margin-top:5px;flex-wrap:nowrap">
          <input id="mediaVolume" type="range" min="0" max="100" step="1" value="100" style="flex:1;min-width:140px">
          <span id="mediaVolumeValue" style="min-width:48px;text-align:center">100%</span>
        </div>
      </label>
      <div class="muted" style="align-self:end;padding-bottom:7px">Applies to manual video and web/stream playback.</div>`;

    const checkboxToolbar=muted.closest(".toolbar")||muted.parentElement?.parentElement;
    if(checkboxToolbar?.parentElement)checkboxToolbar.parentElement.insertBefore(wrap,checkboxToolbar);
    else opacity.parentElement?.appendChild(wrap);

    const slider=el("mediaVolume"),value=el("mediaVolumeValue");
    slider.addEventListener("input",()=>{
      value.textContent=`${slider.value}%`;
      if(Number(slider.value)===0)muted.checked=true;
      else if(muted.checked)muted.checked=false;
    });
    muted.addEventListener("change",()=>{
      if(muted.checked){slider.dataset.prior=slider.value;slider.value="0";value.textContent="0%"}
      else if(Number(slider.value)===0){slider.value=slider.dataset.prior&&Number(slider.dataset.prior)>0?slider.dataset.prior:"100";value.textContent=`${slider.value}%`}
    });

    window.sendMedia=(type)=>{
      const volume=Math.max(0,Math.min(1,Number(slider.value||0)/100));
      const isVideo=type==="display.video";
      const isWeb=type==="display.web";
      if(typeof window.controllerDisplayCommand!=="function"||typeof window.controllerDisplayTargetArg!=="function")throw new Error("Display controller command bridge is unavailable");
      return window.controllerDisplayCommand(type,window.controllerDisplayTargetArg(),{
        url:el("mediaUrl").value,
        fit:el("mediaFit").value,
        opacity:Number(el("mediaOpacity").value),
        autoplay:el("videoAutoplay").checked,
        loop:el("videoLoop").checked,
        muted:muted.checked||volume<=0,
        volume,
        ...(isWeb?{forceAudio:volume>0}:{}),
        ...(isVideo?{forceAudio:volume>0}:{}),
        localDirect:el("mediaLocalDirect")?.checked!==false
      });
    };
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();
