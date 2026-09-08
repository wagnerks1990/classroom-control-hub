from pathlib import Path

p = Path('public/display/index.html')
s = p.read_text()

# Make configured font sizes authoritative while carrying the live-tested display fix forward.
s = s.replace(
    "let textOptions={size:64,autoFit:true},titleOptions={size:92,autoFit:true},subtitleOptions={size:44,autoFit:true};",
    "let textOptions={size:64,autoFit:false},titleOptions={size:92,autoFit:false},subtitleOptions={size:44,autoFit:false};"
)
s = s.replace("autoFit:p.autoFit!==false", "autoFit:p.autoFit===true")

old = """let maSendspinPlayer=null,maSendspinState={state:'detached'},maAttachGeneration=0,maProxySocket=null;
function maFriendlyName(){return id==='tv5'?'Classroom Control Hub - Hallway Display':`Classroom Control Hub - ${id.toUpperCase()}`}
function reportMusicAssistantStatus(extra={}){maSendspinState={...maSendspinState,...extra,updatedAt:new Date().toISOString()};if(!preview&&ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'music.assistant.status',status:maSendspinState}))}catch{}}}
function maAbsoluteProxyUrl(proxyUrl){const proto=location.protocol==='https:'?'wss:':'ws:';return proxyUrl.startsWith('ws:')||proxyUrl.startsWith('wss:')?proxyUrl:`${proto}//${location.host}${proxyUrl.startsWith('/')?'':'/'}${proxyUrl}`}
function attachMusicAssistant(p){
  if(preview)return;
  const generation=++maAttachGeneration;
  try{
    if(maSendspinPlayer){try{maSendspinPlayer.disconnect('restart')}catch{};maSendspinPlayer=null}
    if(maProxySocket){try{maProxySocket.close()}catch{};maProxySocket=null}
    const playerId=String(p.playerId||`classroom-hub-${id}`),proxyUrl=maAbsoluteProxyUrl(String(p.proxyUrl||''));
    if(!p.proxyUrl)throw new Error('Classroom Control Hub did not provide a Music Assistant proxy ticket');
    let protocolActive=false;
    const desiredVolume=Math.max(0,Math.min(100,Number(p.desiredVolume??20))),desiredMuted=!!p.desiredMuted;
    reportMusicAssistantStatus({state:'proxy-connecting',transport:'authenticated-ma-sendspin-proxy',name:maFriendlyName(),playerId,clientId:playerId,protocolActive:false,audioLocked:false,error:null,sdkVersion:String(p.sdkVersion||'3.2.0'),desiredVolume,desiredMuted});
    const socket=new WebSocket(proxyUrl);socket.binaryType='arraybuffer';maProxySocket=socket;
    maSendspinPlayer=new SendspinPlayer({
      playerId,baseUrl:'http://sendspin.local',webSocket:socket,clientName:maFriendlyName(),
      codecs:['opus','flac'],requiredLeadTimeMs:250,minBufferMs:2500,correctionMode:'quality-local',
      onStateChange:(st)=>{if(generation!==maAttachGeneration)return;protocolActive=true;reportMusicAssistantStatus({state:st?.isPlaying?'playing':'connected',transport:'authenticated-ma-sendspin-proxy',playerId,clientId:playerId,protocolActive:true,isPlaying:!!st?.isPlaying,volume:st?.volume,muted:!!st?.muted,error:null})},
      onDelayCommand:(delayMs)=>{try{localStorage.setItem(`classroom-hub.sendspin.${id}.delay`,String(delayMs))}catch{}}
    });
    try{maSendspinPlayer.setVolume(desiredVolume);maSendspinPlayer.setMuted(desiredMuted)}catch{}
    socket.addEventListener('open',()=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:'proxy-authenticating',proxyState:'open',desiredVolume,desiredMuted})});
    socket.addEventListener('close',(e)=>{if(generation!==maAttachGeneration)return;maProxySocket=null;maSendspinPlayer=null;const reason=`Music Assistant proxy closed (${e.code}${e.reason?`: ${e.reason}`:''})`;reportMusicAssistantStatus({state:protocolActive?'reconnecting':'error',proxyState:'closed',protocolActive:false,isPlaying:false,error:protocolActive?null:reason});if(protocolActive&&ws&&ws.readyState===1){setTimeout(()=>{if(generation===maAttachGeneration&&ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'music.assistant.reconnect.request'}))}catch{}}},1500)}});
    socket.addEventListener('error',()=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:'error',proxyState:'error',error:'Classroom Control Hub Music Assistant proxy connection failed'})});
    maSendspinPlayer.connect().then(()=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:protocolActive?'connected':'sendspin-connected',proxyState:'authenticated'})}).catch(e=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:'error',error:String(e?.message||e)})});
    setTimeout(()=>{if(generation!==maAttachGeneration||protocolActive)return;reportMusicAssistantStatus({state:'protocol-timeout',protocolActive:false,error:'Authenticated Music Assistant proxy opened, but Sendspin 3.x player activation did not complete within 20 seconds.'})},20000);
  }catch(e){if(generation===maAttachGeneration)reportMusicAssistantStatus({state:'error',protocolActive:false,error:String(e?.message||e)});console.error('Music Assistant stable Sendspin attach failed',e)}
}
function detachMusicAssistant(){maAttachGeneration++;if(maSendspinPlayer){try{maSendspinPlayer.disconnect('user_request')}catch{};maSendspinPlayer=null}if(maProxySocket){try{maProxySocket.close()}catch{};maProxySocket=null}reportMusicAssistantStatus({state:'detached',isPlaying:false,protocolActive:false,audioLocked:false,error:null,proxyState:'closed'})}
"""

new = """let maSendspinPlayer=null,maSendspinState={state:'detached'},maAttachGeneration=0,maProxySocket=null,maReconnectTimer=null,maReconnectAttempts=0,maActivePlayerId='',maDesiredVolume=20,maDesiredMuted=false;
function maFriendlyName(){return id==='tv5'?'Classroom Control Hub - Hallway Display':`Classroom Control Hub - ${id.toUpperCase()}`}
function reportMusicAssistantStatus(extra={}){maSendspinState={...maSendspinState,...extra,updatedAt:new Date().toISOString()};if(!preview&&ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'music.assistant.status',status:maSendspinState}))}catch{}}}
function maAbsoluteProxyUrl(proxyUrl){const proto=location.protocol==='https:'?'wss:':'ws:';return proxyUrl.startsWith('ws:')||proxyUrl.startsWith('wss:')?proxyUrl:`${proto}//${location.host}${proxyUrl.startsWith('/')?'':'/'}${proxyUrl}`}
function clearMaReconnect(){if(maReconnectTimer){clearTimeout(maReconnectTimer);maReconnectTimer=null}}
function applyMusicAssistantDesiredState(player,generation){
  if(!player||generation!==maAttachGeneration)return;
  try{player.setVolume(maDesiredVolume);player.setMuted(maDesiredMuted)}catch(e){console.warn('Music Assistant desired state apply failed',e)}
}
function scheduleMusicAssistantReconnect(generation){
  if(generation!==maAttachGeneration||maReconnectTimer||!ws||ws.readyState!==1)return;
  maReconnectAttempts=Math.min(maReconnectAttempts+1,6);
  const delay=Math.min(30000,1500*(2**Math.max(0,maReconnectAttempts-1)));
  if(maReconnectAttempts>=6){reportMusicAssistantStatus({state:'error',proxyState:'closed',protocolActive:false,error:'Music Assistant proxy repeatedly disconnected; automatic retries paused after 6 attempts.'});return}
  reportMusicAssistantStatus({state:'reconnecting',proxyState:'closed',protocolActive:false,reconnectAttempt:maReconnectAttempts,reconnectDelayMs:delay});
  maReconnectTimer=setTimeout(()=>{
    maReconnectTimer=null;
    if(generation!==maAttachGeneration||!ws||ws.readyState!==1)return;
    try{ws.send(JSON.stringify({type:'music.assistant.reconnect.request',attempt:maReconnectAttempts}))}catch{}
  },delay);
}
function attachMusicAssistant(p){
  if(preview)return;
  try{
    const playerId=String(p.playerId||`classroom-hub-${id}`),proxyUrl=maAbsoluteProxyUrl(String(p.proxyUrl||''));
    if(!p.proxyUrl)throw new Error('Classroom Control Hub did not provide a Music Assistant proxy ticket');
    maDesiredVolume=Math.max(0,Math.min(100,Number(p.desiredVolume??maDesiredVolume??20)));
    maDesiredMuted=!!p.desiredMuted;

    // Repeated attach commands for the same active player should update desired
    // state, not tear down a healthy or still-connecting Sendspin session.
    if(maActivePlayerId===playerId&&maSendspinPlayer&&maProxySocket&&[WebSocket.CONNECTING,WebSocket.OPEN].includes(maProxySocket.readyState)){
      if(maSendspinState.protocolActive)applyMusicAssistantDesiredState(maSendspinPlayer,maAttachGeneration);
      reportMusicAssistantStatus({desiredVolume:maDesiredVolume,desiredMuted:maDesiredMuted,duplicateAttachIgnored:true});
      return;
    }

    clearMaReconnect();
    const generation=++maAttachGeneration;
    if(maSendspinPlayer){try{maSendspinPlayer.disconnect('restart')}catch{};maSendspinPlayer=null}
    if(maProxySocket){try{maProxySocket.close()}catch{};maProxySocket=null}
    maActivePlayerId=playerId;
    let protocolActive=false,desiredApplied=false;
    reportMusicAssistantStatus({state:'proxy-connecting',transport:'authenticated-ma-sendspin-proxy',name:maFriendlyName(),playerId,clientId:playerId,protocolActive:false,audioLocked:false,error:null,sdkVersion:String(p.sdkVersion||'3.2.0'),desiredVolume:maDesiredVolume,desiredMuted:maDesiredMuted,reconnectAttempt:maReconnectAttempts});
    const socket=new WebSocket(proxyUrl);socket.binaryType='arraybuffer';maProxySocket=socket;
    const player=new SendspinPlayer({
      playerId,baseUrl:'http://sendspin.local',webSocket:socket,clientName:maFriendlyName(),
      codecs:['opus','flac'],requiredLeadTimeMs:250,minBufferMs:2500,correctionMode:'quality-local',
      onStateChange:(st)=>{
        if(generation!==maAttachGeneration)return;
        protocolActive=true;maReconnectAttempts=0;
        if(!desiredApplied){desiredApplied=true;applyMusicAssistantDesiredState(player,generation)}
        reportMusicAssistantStatus({state:st?.isPlaying?'playing':'connected',transport:'authenticated-ma-sendspin-proxy',playerId,clientId:playerId,protocolActive:true,isPlaying:!!st?.isPlaying,volume:st?.volume,muted:!!st?.muted,error:null,reconnectAttempt:0})
      },
      onDelayCommand:(delayMs)=>{try{localStorage.setItem(`classroom-hub.sendspin.${id}.delay`,String(delayMs))}catch{}}
    });
    maSendspinPlayer=player;
    socket.addEventListener('open',()=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:'proxy-authenticating',proxyState:'open',desiredVolume:maDesiredVolume,desiredMuted:maDesiredMuted})});
    socket.addEventListener('close',(e)=>{
      if(generation!==maAttachGeneration)return;
      maProxySocket=null;maSendspinPlayer=null;
      const reason=`Music Assistant proxy closed (${e.code}${e.reason?`: ${e.reason}`:''})`;
      console.warn(reason,{code:e.code,reason:e.reason,wasClean:e.wasClean,protocolActive});
      reportMusicAssistantStatus({state:protocolActive?'reconnecting':'error',proxyState:'closed',protocolActive:false,isPlaying:false,lastCloseCode:e.code,lastCloseReason:e.reason||'',lastCloseClean:!!e.wasClean,error:protocolActive?null:reason});
      if(protocolActive)scheduleMusicAssistantReconnect(generation);
    });
    socket.addEventListener('error',(e)=>{if(generation===maAttachGeneration){console.warn('Music Assistant proxy WebSocket error',e);reportMusicAssistantStatus({state:'error',proxyState:'error',error:'Classroom Control Hub Music Assistant proxy connection failed'})}});
    player.connect().then(()=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:protocolActive?'connected':'sendspin-connected',proxyState:'authenticated'})}).catch(e=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:'error',error:String(e?.message||e)})});
    setTimeout(()=>{if(generation!==maAttachGeneration||protocolActive)return;reportMusicAssistantStatus({state:'protocol-timeout',protocolActive:false,error:'Authenticated Music Assistant proxy opened, but Sendspin 3.x player activation did not complete within 20 seconds.'})},20000);
  }catch(e){reportMusicAssistantStatus({state:'error',protocolActive:false,error:String(e?.message||e)});console.error('Music Assistant stable Sendspin attach failed',e)}
}
function detachMusicAssistant(){clearMaReconnect();maReconnectAttempts=0;maAttachGeneration++;maActivePlayerId='';if(maSendspinPlayer){try{maSendspinPlayer.disconnect('user_request')}catch{};maSendspinPlayer=null}if(maProxySocket){try{maProxySocket.close()}catch{};maProxySocket=null}reportMusicAssistantStatus({state:'detached',isPlaying:false,protocolActive:false,audioLocked:false,error:null,proxyState:'closed'})}
"""

if old not in s:
    raise SystemExit('Expected Music Assistant lifecycle block was not found; refusing partial patch')
s = s.replace(old, new)
p.write_text(s)
print('Applied Music Assistant / Sendspin lifecycle hardening')
