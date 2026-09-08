from pathlib import Path

server = Path('src/server.js')
display = Path('public/display/index.html')

s = server.read_text()

old_payload = '''function musicAssistantTvAttachPayload(deviceId,issued,extra={}){const audio=musicAssistantTvAudioState(deviceId);return {transport:"authenticated-ma-sendspin-proxy",proxyUrl:musicAssistantProxyPath(issued.ticket),playerId:issued.playerId,sdkVersion:"3.2.0",desiredVolume:audio.volume,desiredMuted:audio.muted,...extra}}'''
new_payload = '''function musicAssistantDirectSendspinUrl(){const cfg=musicAssistantConfig(),host=String(cfg.sendspinHost||"host.docker.internal").trim(),port=Math.max(1,Math.min(65535,Number(cfg.sendspinPort||8927))),hostForUrl=host.includes(":")&&!host.startsWith("[")?`[${host}]`:host;return `ws://${hostForUrl}:${port}/sendspin`}
function musicAssistantTvAttachPayload(deviceId,issued,extra={}){const audio=musicAssistantTvAudioState(deviceId),playerId=issued?.playerId||`classroom-hub-${cleanId(deviceId)}`;return {transport:"direct-ma-sendspin",sendspinUrl:musicAssistantDirectSendspinUrl(),proxyUrl:issued?.ticket?musicAssistantProxyPath(issued.ticket):"",playerId,sdkVersion:"3.2.0",desiredVolume:audio.volume,desiredMuted:audio.muted,...extra}}'''
if old_payload not in s:
    raise SystemExit('Expected Music Assistant TV attach payload not found; refusing partial direct-Sendspin patch')
s = s.replace(old_payload, new_payload, 1)

# Advertise the active transport accurately while retaining proxy fields for compatibility diagnostics.
s = s.replace('transport:"authenticated-ma-sendspin-proxy",apiTransport:', 'transport:"direct-ma-sendspin",apiTransport:')
s = s.replace('note:"Stable Music Assistant 2.9 bridge: Classroom Control Hub authenticates the MA /sendspin proxy server-side. The long-lived token is never sent to TV browsers."',
'''note:"Music Assistant control stays authenticated through Classroom Control Hub while TV audio connects directly to the dedicated Sendspin server on port 8927. The long-lived API token is never sent to TV browsers."''')
server.write_text(s)

d = display.read_text()

# Support both a direct MA Sendspin URL and the legacy Hub proxy URL. Direct is preferred.
old_open = '''    const playerId=String(p.playerId||`classroom-hub-${id}`),proxyUrl=maAbsoluteProxyUrl(String(p.proxyUrl||''));
    if(!p.proxyUrl)throw new Error('Classroom Control Hub did not provide a Music Assistant proxy ticket');'''
new_open = '''    const playerId=String(p.playerId||`classroom-hub-${id}`),transport=String(p.transport||'direct-ma-sendspin');
    const suppliedSocketUrl=String(p.sendspinUrl||p.proxyUrl||'');
    if(!suppliedSocketUrl)throw new Error('Classroom Control Hub did not provide a Music Assistant Sendspin endpoint');
    const socketUrl=p.sendspinUrl?suppliedSocketUrl:maAbsoluteProxyUrl(suppliedSocketUrl);'''
if old_open not in d:
    raise SystemExit('Expected Music Assistant display connection block not found; run apply-sendspin-lifecycle-fix.py first')
d = d.replace(old_open, new_open, 1)

d = d.replace("reportMusicAssistantStatus({state:'proxy-connecting',transport:'authenticated-ma-sendspin-proxy'", "reportMusicAssistantStatus({state:'sendspin-connecting',transport")
d = d.replace("const socket=new WebSocket(proxyUrl);", "const socket=new WebSocket(socketUrl);")
d = d.replace("transport:'authenticated-ma-sendspin-proxy',playerId", "transport,playerId")
d = d.replace("state:'proxy-authenticating',proxyState:'open'", "state:'sendspin-socket-open',proxyState:'open'")
d = d.replace("const reason=`Music Assistant proxy closed (${e.code}${e.reason?`: ${e.reason}`:''})`;", "const reason=`Music Assistant Sendspin closed (${e.code}${e.reason?`: ${e.reason}`:''})`;")
d = d.replace("error:'Classroom Control Hub Music Assistant proxy connection failed'", "error:'Music Assistant Sendspin connection failed'")
d = d.replace("error:'Authenticated Music Assistant proxy opened, but Sendspin 3.x player activation did not complete within 20 seconds.'", "error:'Music Assistant Sendspin socket opened, but player activation did not complete within 20 seconds.'")
d = d.replace("console.error('Music Assistant stable Sendspin attach failed',e)", "console.error('Music Assistant Sendspin attach failed',e)")

display.write_text(d)
print('Enabled direct Music Assistant Sendspin transport on port 8927 with proxy compatibility fallback')
