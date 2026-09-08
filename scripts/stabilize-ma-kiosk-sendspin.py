from pathlib import Path

server = Path('src/server.js')
display = Path('public/display/index.html')

s = server.read_text()

# The Sendspin SDK owns reconnects. A reconnect request from an older/stale display
# must never cause the Hub to create a second player instance with the same player ID.
old = '''      if (msg.type === "music.assistant.reconnect.request" && ws.role === "display") {
        const attached=dbStore.getPreference("musicassistant.tvBridgeTargets",[])||[];
        if(Array.isArray(attached)&&attached.includes(ws.deviceId)&&musicAssistantToken()){
          ws.maAudioRestored=false;ws.maAudioRestorePending=false;
          const issued=issueMusicAssistantProxyTicket(ws.deviceId);
          wsSend(ws,{type:"command",command:{type:"music.assistant.attach",target:ws.deviceId,payload:musicAssistantTvAttachPayload(ws.deviceId,issued,{reconnect:true})}});
          audit({kind:"musicassistant.sendspin.reconnect-issued",deviceId:ws.deviceId});
        }
        return;
      }'''
new = '''      if (msg.type === "music.assistant.reconnect.request" && ws.role === "display") {
        // SendspinPlayer owns its socket/reconnect lifecycle. Re-issuing attach here
        // creates competing instances with the same classroom-hub-tvN player ID and
        // causes audible dropouts while Music Assistant replaces the active client.
        audit({kind:"musicassistant.sendspin.reconnect-ignored",deviceId:ws.deviceId,reason:"sdk-owned-lifecycle"});
        return;
      }'''
if old in s:
    s = s.replace(old, new, 1)
elif 'musicassistant.sendspin.reconnect-ignored' not in s:
    print('Warning: legacy reconnect-request handler not found; continuing with display lifecycle patch')

server.write_text(s)

d = display.read_text()
start = d.index("let maSendspinPlayer=null,maSendspinState={state:'detached'}")
end = d.index("\nfunction handle(c)", start)

block = r'''let maSendspinPlayer=null,maSendspinState={state:'detached'},maAttachGeneration=0,maActivePlayerId='',maActiveBaseUrl='',maDesiredVolume=20,maDesiredMuted=false,maDesiredApplied=false;
function maFriendlyName(){return id==='tv5'?'Classroom Control Hub - Hallway Display':`Classroom Control Hub - ${id.toUpperCase()}`}
function reportMusicAssistantStatus(extra={}){maSendspinState={...maSendspinState,...extra,updatedAt:new Date().toISOString()};if(!preview&&ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'music.assistant.status',status:maSendspinState}))}catch{}}}
function applyMusicAssistantDesiredState(player,generation){
  if(!player||generation!==maAttachGeneration||maDesiredApplied)return;
  try{player.setVolume(maDesiredVolume);player.setMuted(maDesiredMuted);maDesiredApplied=true}catch(e){console.warn('Music Assistant desired state apply deferred',e)}
}
function attachMusicAssistant(p){
  if(preview)return;
  try{
    const playerId=String(p.playerId||`classroom-hub-${id}`),baseUrl=String(p.sendspinBaseUrl||'').replace(/\/$/,'');
    if(!baseUrl)throw new Error('Classroom Control Hub did not provide a Music Assistant Sendspin base URL');
    maDesiredVolume=Math.max(0,Math.min(100,Number(p.desiredVolume??maDesiredVolume??20)));maDesiredMuted=!!p.desiredMuted;

    // Single-owner rule: once this physical display owns a SendspinPlayer, any
    // repeated attach for the same player/base URL is only a desired-state update.
    // This remains true while the SDK is internally reconnecting.
    if(maActivePlayerId===playerId&&maActiveBaseUrl===baseUrl&&maSendspinPlayer){
      applyMusicAssistantDesiredState(maSendspinPlayer,maAttachGeneration);
      reportMusicAssistantStatus({desiredVolume:maDesiredVolume,desiredMuted:maDesiredMuted,duplicateAttachIgnored:true,error:null});
      return;
    }

    const generation=++maAttachGeneration;
    if(maSendspinPlayer){try{maSendspinPlayer.disconnect('configuration_changed')}catch{};maSendspinPlayer=null}
    maActivePlayerId=playerId;maActiveBaseUrl=baseUrl;maDesiredApplied=false;
    let protocolActive=false;
    reportMusicAssistantStatus({state:'sendspin-connecting',transport:'ma-kiosk-sendspin',name:maFriendlyName(),playerId,clientId:playerId,protocolActive:false,audioLocked:false,error:null,sdkVersion:String(p.sdkVersion||'3.2.0'),desiredVolume:maDesiredVolume,desiredMuted:maDesiredMuted,baseUrl});

    // Match Music Assistant 2.9.x's own Web Kiosk Sendspin configuration.
    const playerConfig={
      playerId,
      baseUrl,
      clientName:maFriendlyName(),
      correctionMode:'sync',
      onStateChange:(st)=>{
        if(generation!==maAttachGeneration)return;
        protocolActive=true;
        applyMusicAssistantDesiredState(player,generation);
        reportMusicAssistantStatus({state:st?.isPlaying?'playing':'connected',transport:'ma-kiosk-sendspin',playerId,clientId:playerId,protocolActive:true,isPlaying:!!st?.isPlaying,volume:st?.volume,muted:!!st?.muted,error:null,duplicateAttachIgnored:false});
      },
      onDelayCommand:(delayMs)=>{try{localStorage.setItem(`classroom-hub.sendspin.${id}.delay`,String(delayMs))}catch{}}
    };
    if(typeof AudioDecoder==='undefined')playerConfig.codecs=['flac','pcm'];

    const player=new SendspinPlayer(playerConfig);
    maSendspinPlayer=player;
    player.connect().then(()=>{
      if(generation!==maAttachGeneration)return;
      reportMusicAssistantStatus({state:protocolActive?'connected':'sendspin-connected',transport:'ma-kiosk-sendspin',protocolActive:protocolActive||maSendspinState.protocolActive,error:null});
    }).catch(e=>{
      if(generation!==maAttachGeneration)return;
      const reason=String(e?.message||e||'Music Assistant Sendspin connection failed');
      console.warn('Music Assistant SDK-managed Sendspin connection failed',reason);
      reportMusicAssistantStatus({state:'error',transport:'ma-kiosk-sendspin',protocolActive:false,isPlaying:false,error:reason});
    });
    setTimeout(()=>{if(generation!==maAttachGeneration||protocolActive)return;reportMusicAssistantStatus({state:'protocol-timeout',protocolActive:false,error:'Music Assistant Sendspin player activation did not complete within 20 seconds.'})},20000);
  }catch(e){reportMusicAssistantStatus({state:'error',protocolActive:false,error:String(e?.message||e)});console.error('Music Assistant Sendspin attach failed',e)}
}
function detachMusicAssistant(){maAttachGeneration++;maActivePlayerId='';maActiveBaseUrl='';maDesiredApplied=false;if(maSendspinPlayer){try{maSendspinPlayer.disconnect('user_request')}catch{};maSendspinPlayer=null}reportMusicAssistantStatus({state:'detached',isPlaying:false,protocolActive:false,audioLocked:false,error:null})}
'''

d = d[:start] + block + d[end:]
display.write_text(d)
print('Stabilized Music Assistant Sendspin: single owner, SDK reconnects, MA kiosk defaults')
