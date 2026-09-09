from pathlib import Path

p = Path("src/server.js")
s = p.read_text()

old = '''    const cfg=musicAssistantConfig(),token=musicAssistantToken();if(!token)return finish(1011,"Music Assistant token is not configured");
    const maUrl=new URL(cfg.url),scheme=maUrl.protocol==="https:"?"wss:":"ws:";maUrl.protocol=scheme;maUrl.pathname=(maUrl.pathname.replace(/\\/$/,"")+"/sendspin").replace(/\\/\\//g,"/");maUrl.search="";maUrl.hash="";
    upstream=new WebSocket(maUrl.toString());upstream.binaryType="arraybuffer";
    const authTimer=setTimeout(()=>finish(1011,"Music Assistant proxy authentication timed out"),10000);
    upstream.on("open",()=>{try{upstream.send(JSON.stringify({type:"auth",token,client_id:ticket.playerId}))}catch(e){finish(1011,e.message)}});
    upstream.on("message",(data,isBinary)=>{
      if(!authenticated){
        clearTimeout(authTimer);
        if(isBinary)return finish(1011,"Unexpected binary Music Assistant authentication response");
        let ack={};try{ack=JSON.parse(Buffer.isBuffer(data)?data.toString("utf8"):String(data))}catch{}
        if(ack&&((ack.error)||(String(ack.type||"").toLowerCase().includes("invalid"))))return finish(1008,ack.error?.message||ack.error||"Music Assistant authentication rejected");
        authenticated=true;
        for(const frame of pending.splice(0)){if(upstream.readyState===WebSocket.OPEN)upstream.send(frame.data,{binary:frame.isBinary})}
        audit({kind:"musicassistant.sendspin.proxy.authenticated",deviceId:ticket.deviceId,playerId:ticket.playerId});
        return;
      }
      if(client.readyState===WebSocket.OPEN)client.send(data,{binary:isBinary});
    });
'''

new = '''    const cfg=musicAssistantConfig();
    const sendspinHost=String(cfg.sendspinHost||"host.docker.internal").trim();
    const sendspinPort=Math.max(1,Math.min(65535,Number(cfg.sendspinPort||8927)));
    const hostForUrl=sendspinHost.includes(":")&&!sendspinHost.startsWith("[")?`[${sendspinHost}]`:sendspinHost;
    const upstreamUrl=`ws://${hostForUrl}:${sendspinPort}/sendspin`;
    upstream=new WebSocket(upstreamUrl);upstream.binaryType="arraybuffer";
    const connectTimer=setTimeout(()=>finish(1011,"Music Assistant Sendspin upstream connection timed out"),10000);
    upstream.on("open",()=>{
      authenticated=true;clearTimeout(connectTimer);
      for(const frame of pending.splice(0)){if(upstream.readyState===WebSocket.OPEN)upstream.send(frame.data,{binary:frame.isBinary})}
      audit({kind:"musicassistant.sendspin.proxy.connected",deviceId:ticket.deviceId,playerId:ticket.playerId,upstreamUrl});
    });
    upstream.on("message",(data,isBinary)=>{
      if(client.readyState===WebSocket.OPEN)client.send(data,{binary:isBinary});
    });
'''

already = "const upstreamUrl=`ws://${hostForUrl}:${sendspinPort}/sendspin`;"
if already in s:
    print("Music Assistant Sendspin proxy already uses the dedicated 8927 endpoint")
    raise SystemExit(0)

count = s.count(old)
if count != 1:
    raise SystemExit(
        f"Expected exactly one current Sendspin proxy block, found {count}; refusing partial patch"
    )

s = s.replace(old, new, 1)

old_comment = '''// Stable Music Assistant 2.9.x Sendspin proxy. TVs connect only to Classroom Control Hub.
// Classroom Control Hub opens MA's authenticated /sendspin socket, sends the encrypted-at-rest
// long-lived token server-side, consumes the auth acknowledgement, then transparently
// relays Sendspin 3.x frames. One-time tickets prevent arbitrary use of this bridge.'''
new_comment = '''// Music Assistant Sendspin proxy. TVs connect only to Classroom Control Hub.
// Classroom Control Hub opens Music Assistant's dedicated local Sendspin endpoint
// (normally ws://MA-HOST:8927/sendspin) and transparently relays protocol frames.
// The Hub's one-time display ticket gates access to this bridge. The long-lived
// Music Assistant API token remains server-side for the separate control API.'''
if old_comment in s:
    s = s.replace(old_comment, new_comment, 1)

p.write_text(s)
print("Patched Music Assistant Sendspin proxy to dedicated port 8927 transport")
