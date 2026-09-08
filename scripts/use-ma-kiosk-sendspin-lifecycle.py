from pathlib import Path

server = Path('src/server.js')
display = Path('public/display/index.html')

s = server.read_text()

# Add a browser-compatible base URL matching Music Assistant 2.9.x's own kiosk player.
old = '''function musicAssistantDirectSendspinUrl(){const cfg=musicAssistantConfig();let apiHost="";try{apiHost=new URL(cfg.url).hostname||""}catch{}let host=String(cfg.sendspinHost||apiHost||"host.docker.internal").trim();if(host==="host.docker.internal"&&apiHost&&apiHost!=="host.docker.internal")host=apiHost;const port=Math.max(1,Math.min(65535,Number(cfg.sendspinPort||8927))),hostForUrl=host.includes(":")&&!host.startsWith("[")?`[${host}]`:host;return `ws://${hostForUrl}:${port}/sendspin`}
function musicAssistantTvAttachPayload(deviceId,issued,extra={}){const audio=musicAssistantTvAudioState(deviceId),playerId=issued?.playerId||`classroom-hub-${cleanId(deviceId)}`;return {transport:"direct-ma-sendspin",sendspinUrl:musicAssistantDirectSendspinUrl(),proxyUrl:issued?.ticket?musicAssistantProxyPath(issued.ticket):"",playerId,sdkVersion:"3.2.0",desiredVolume:audio.volume,desiredMuted:audio.muted,...extra}}'''
new = '''function musicAssistantDirectSendspinBaseUrl(){const cfg=musicAssistantConfig();let apiHost="";try{apiHost=new URL(cfg.url).hostname||""}catch{}let host=String(cfg.sendspinHost||apiHost||"host.docker.internal").trim();if(host==="host.docker.internal"&&apiHost&&apiHost!=="host.docker.internal")host=apiHost;const port=Math.max(1,Math.min(65535,Number(cfg.sendspinPort||8927))),hostForUrl=host.includes(":")&&!host.startsWith("[")?`[${host}]`:host;return `http://${hostForUrl}:${port}`}
function musicAssistantTvAttachPayload(deviceId,issued,extra={}){const audio=musicAssistantTvAudioState(deviceId),playerId=issued?.playerId||`classroom-hub-${cleanId(deviceId)}`;return {transport:"ma-kiosk-sendspin",sendspinBaseUrl:musicAssistantDirectSendspinBaseUrl(),proxyUrl:issued?.ticket?musicAssistantProxyPath(issued.ticket):"",playerId,sdkVersion:"3.2.0",desiredVolume:audio.volume,desiredMuted:audio.muted,...extra}}'''
if old not in s:
    raise SystemExit('Expected direct Sendspin payload block not found; apply enable-direct-music-assistant-sendspin.py first')
s = s.replace(old, new, 1)
s = s.replace('transport:"direct-ma-sendspin",apiTransport:', 'transport:"ma-kiosk-sendspin",apiTransport:')
server.write_text(s)

d = display.read_text()
start = d.index("let maSendspinPlayer=null,maSendspinState={state:'detached'}")
end = d.index("\nfunction handle(c)", start)

block = r'''let maSendspinPlayer=null,maSendspinState={state:'detached'},maAttachGeneration=0,maReconnectTimer=null,maReconnectAttempts=0,maActivePlayerId='',maDesiredVolume=20,maDesiredMuted=false;
function maFriendlyName(){return id==='tv5'?'Classroom Control Hub - Hallway Display':`Classroom Control Hub - ${id.toUpperCase()}`}
function reportMusicAssistantStatus(extra={}){maSendspinState={...maSendspinState,...extra,updatedAt:new Date().toISOString()};if(!preview&&ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'music.assistant.status',status:maSendspinState}))}catch{}}}
function clearMaReconnect(){if(maReconnectTimer){clearTimeout(maReconnectTimer);maReconnectTimer=null}}
function applyMusicAssistantDesiredState(player,generation){if(!player||generation!==maAttachGeneration)return;try{player.setVolume(maDesiredVolume);player.setMuted(maDesiredMuted)}catch(e){console.warn('Music Assistant desired state apply failed',e)}}
function scheduleMusicAssistantReconnect(generation,p){
  if(generation!==maAttachGeneration||maReconnectTimer)return;
  maReconnectAttempts=Math.min(maReconnectAttempts+1,6);
  if(maReconnectAttempts>=6){reportMusicAssistantStatus({state:'error',protocolActive:false,error:'Music Assistant Sendspin repeatedly disconnected; automatic retries paused after 6 attempts.'});return}
  const delay=Math.min(30000,1500*(2**Math.max(0,maReconnectAttempts-1)));
  reportMusicAssistantStatus({state:'reconnecting',protocolActive:false,reconnectAttempt:maReconnectAttempts,reconnectDelayMs:delay});
  maReconnectTimer=setTimeout(()=>{maReconnectTimer=null;if(generation===maAttachGeneration)attachMusicAssistant({...p,reconnect:true})},delay);
}
function attachMusicAssistant(p){
  if(preview)return;
  try{
    const playerId=String(p.playerId||`classroom-hub-${id}`),baseUrl=String(p.sendspinBaseUrl||'').replace(/\/$/,'');
    if(!baseUrl)throw new Error('Classroom Control Hub did not provide a Music Assistant Sendspin base URL');
    maDesiredVolume=Math.max(0,Math.min(100,Number(p.desiredVolume??maDesiredVolume??20)));maDesiredMuted=!!p.desiredMuted;
    if(!p.reconnect&&maActivePlayerId===playerId&&maSendspinPlayer&&maSendspinState.protocolActive){applyMusicAssistantDesiredState(maSendspinPlayer,maAttachGeneration);reportMusicAssistantStatus({desiredVolume:maDesiredVolume,desiredMuted:maDesiredMuted,duplicateAttachIgnored:true});return}
    clearMaReconnect();
    const generation=++maAttachGeneration;
    if(maSendspinPlayer){try{maSendspinPlayer.disconnect('restart')}catch{};maSendspinPlayer=null}
    maActivePlayerId=playerId;
    let protocolActive=false,desiredApplied=false;
    reportMusicAssistantStatus({state:'sendspin-connecting',transport:'ma-kiosk-sendspin',name:maFriendlyName(),playerId,clientId:playerId,protocolActive:false,audioLocked:false,error:null,sdkVersion:String(p.sdkVersion||'3.2.0'),desiredVolume:maDesiredVolume,desiredMuted:maDesiredMuted,reconnectAttempt:maReconnectAttempts,baseUrl});
    const player=new SendspinPlayer({
      playerId,baseUrl,clientName:maFriendlyName(),
      codecs:['opus','flac'],requiredLeadTimeMs:250,minBufferMs:2500,correctionMode:'quality-local',
      reconnect:{baseDelayMs:1000,maxDelayMs:15000,maxAttempts:0},
      onStateChange:(st)=>{
        if(generation!==maAttachGeneration)return;
        protocolActive=true;maReconnectAttempts=0;
        if(!desiredApplied){desiredApplied=true;applyMusicAssistantDesiredState(player,generation)}
        reportMusicAssistantStatus({state:st?.isPlaying?'playing':'connected',transport:'ma-kiosk-sendspin',playerId,clientId:playerId,protocolActive:true,isPlaying:!!st?.isPlaying,volume:st?.volume,muted:!!st?.muted,error:null,reconnectAttempt:0})
      },
      onDelayCommand:(delayMs)=>{try{localStorage.setItem(`classroom-hub.sendspin.${id}.delay`,String(delayMs))}catch{}}
    });
    maSendspinPlayer=player;
    player.connect().then(()=>{if(generation===maAttachGeneration)reportMusicAssistantStatus({state:protocolActive?'connected':'sendspin-connected',transport:'ma-kiosk-sendspin'})}).catch(e=>{
      if(generation!==maAttachGeneration)return;
      maSendspinPlayer=null;
      const reason=String(e?.message||e||'Music Assistant Sendspin connection closed');
      console.warn('Music Assistant SDK-managed Sendspin connection ended',reason);
      reportMusicAssistantStatus({state:protocolActive?'reconnecting':'error',protocolActive:false,isPlaying:false,error:protocolActive?null:reason});
      if(protocolActive)scheduleMusicAssistantReconnect(generation,p)
    });
    setTimeout(()=>{if(generation!==maAttachGeneration||protocolActive)return;reportMusicAssistantStatus({state:'protocol-timeout',protocolActive:false,error:'Music Assistant Sendspin player activation did not complete within 20 seconds.'})},20000);
  }catch(e){reportMusicAssistantStatus({state:'error',protocolActive:false,error:String(e?.message||e)});console.error('Music Assistant Sendspin attach failed',e)}
}
function detachMusicAssistant(){clearMaReconnect();maReconnectAttempts=0;maAttachGeneration++;maActivePlayerId='';if(maSendspinPlayer){try{maSendspinPlayer.disconnect('user_request')}catch{};maSendspinPlayer=null}reportMusicAssistantStatus({state:'detached',isPlaying:false,protocolActive:false,audioLocked:false,error:null})}
'''

d = d[:start] + block + d[end:]
display.write_text(d)
print('Matched Classroom Hub Sendspin lifecycle to Music Assistant 2.9.x Web Kiosk player')
