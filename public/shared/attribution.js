"use strict";

if(!window.ControlHubBranding&&!document.querySelector('script[src="/shared/branding.js"]')){
  const branding=document.createElement("script");
  branding.src="/shared/branding.js";
  document.head.append(branding);
}

if(location.pathname==="/controller/display.html"&&!document.querySelector('script[src="/shared/manual-media-volume.js"]')){
  const mediaVolume=document.createElement("script");
  mediaVolume.src="/shared/manual-media-volume.js";
  document.head.append(mediaVolume);
}

(function installMorningAnnouncementStability(){
  if(!/^\/display\//.test(location.pathname)||window.__CLASSROOM_HUB_MORNING_STREAM_STABILITY__)return;
  window.__CLASSROOM_HUB_MORNING_STREAM_STABILITY__=true;
  const events=[];
  const stream={active:false,key:"",state:"idle",lastEvent:null,lastEventAt:null,lastPlayerUpdate:null,lastError:null,reassertionsSuppressed:0,takeoverClearsSuppressed:0,player:null};
  function record(kind,detail={}){
    const item={at:new Date().toISOString(),kind,...detail};
    events.push(item);if(events.length>60)events.shift();
    stream.lastEvent=kind;stream.lastEventAt=item.at;
    if(detail.error)stream.lastError=String(detail.error);
    try{console.info("[ClassroomHub MorningStream]",kind,detail)}catch{}
  }
  function mediaKey(payload={}){return JSON.stringify({url:String(payload.url||""),volume:Number(payload.volume??1),muted:!!payload.muted,fit:String(payload.fit||"cover"),contentKind:String(payload.contentKind||"")})}
  function inspectServerMessage(raw){
    if(typeof raw!=="string")return {suppress:false};
    let message;try{message=JSON.parse(raw)}catch{return {suppress:false}}
    if(message?.type==="hello.ack"){
      const media=message?.state?.media;
      if(media?.contentKind==="morning-announcements"){
        stream.active=true;stream.key=mediaKey(media);stream.state="playing-or-connecting";
        record("receiver-state-restored",{url:String(media.url||"")});
      }
      return {suppress:false};
    }
    if(message?.type!=="command")return {suppress:false};
    const command=message.command||{},payload=command.payload||{};
    if(command.type==="display.clear"){
      const reason=String(payload.reason||"");
      if(reason==="morning-announcements-release"){
        stream.active=false;stream.key="";stream.state="released";record("announcement-release",{reason});
        return {suppress:false};
      }
      if(reason==="morning-announcements-takeover"&&stream.active){
        stream.takeoverClearsSuppressed++;
        record("duplicate-takeover-clear-suppressed",{count:stream.takeoverClearsSuppressed});
        return {suppress:true};
      }
      if(reason!=="morning-announcements-takeover"&&stream.active){stream.active=false;stream.key="";stream.state="cleared"}
      return {suppress:false};
    }
    if(command.type==="display.web"&&payload.contentKind==="morning-announcements"){
      const key=mediaKey(payload);
      if(stream.active&&stream.key===key){
        stream.reassertionsSuppressed++;
        record("duplicate-stream-reassert-suppressed",{count:stream.reassertionsSuppressed});
        return {suppress:true};
      }
      stream.active=true;stream.key=key;stream.state="starting";
      record("announcement-stream-command",{url:String(payload.url||""),volume:Number(payload.volume??1)});
    }
    return {suppress:false};
  }
  const descriptor=Object.getOwnPropertyDescriptor(WebSocket.prototype,"onmessage");
  if(descriptor?.set&&descriptor?.get&&descriptor.configurable){
    const assigned=new WeakMap();
    Object.defineProperty(WebSocket.prototype,"onmessage",{
      configurable:true,enumerable:descriptor.enumerable,
      get(){return assigned.get(this)?.original??descriptor.get.call(this)},
      set(handler){
        if(typeof handler!=="function"){assigned.delete(this);return descriptor.set.call(this,handler)}
        const wrapped=function(event){
          const decision=inspectServerMessage(event?.data);
          if(decision.suppress)return;
          return handler.call(this,event);
        };
        assigned.set(this,{original:handler,wrapped});
        return descriptor.set.call(this,wrapped);
      }
    });
    record("websocket-command-filter-installed");
  }else record("websocket-command-filter-unavailable",{error:"WebSocket onmessage accessor is not configurable"});

  const originalSend=WebSocket.prototype.send;
  WebSocket.prototype.send=function(data){
    if(typeof data==="string"){
      try{
        const message=JSON.parse(data);
        if(message?.type==="heartbeat"&&message.meta){
          message.meta.stream={...stream,events:events.slice(-12)};
          data=JSON.stringify(message);
        }
      }catch{}
    }
    return originalSend.call(this,data);
  };

  window.addEventListener("message",event=>{
    if(event.origin!==location.origin)return;
    const data=event.data||{};
    if(data.type!=="classroom-hub.antmedia.telemetry")return;
    const update=data.telemetry||{};
    stream.player={...(stream.player||{}),...update};
    stream.lastPlayerUpdate=new Date().toISOString();
    if(update.state)stream.state=String(update.state);
    if(update.error)stream.lastError=String(update.error);
    record("player-telemetry",{event:update.event||null,state:update.state||null,error:update.error||null,url:update.url||null});
  });
  window.ClassroomStreamDiagnostics=()=>({stream:{...stream,player:stream.player?{...stream.player}:null},events:[...events]});
})();

function addKyleAttribution(){
  if(document.querySelector("[data-kyle-attribution]"))return;
  const footer=document.createElement("footer");
  const renderer=/\/(display|document-viewer|antmedia-player)(\/|$)/.test(location.pathname);
  footer.className=`app-attribution${renderer?" app-attribution--overlay":""}`;
  footer.dataset.kyleAttribution="true";
  footer.append("Built by ");
  const link=document.createElement("a");
  link.href="https://github.com/wagnerks1990";
  link.target="_blank";
  link.rel="author noopener noreferrer";
  link.textContent="Kyle Wagner";
  footer.append(link);
  document.body.append(footer);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",addKyleAttribution,{once:true});
else addKyleAttribution();
