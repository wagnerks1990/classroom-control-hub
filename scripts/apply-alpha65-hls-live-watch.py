from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "src/server.js"
s = SERVER.read_text()

start = s.index('async function probeMorningAnnouncementsLive(){')
end = s.index('\nfunction localMinutesNow', start)
new_probe = '''async function probeMorningAnnouncementsLive(){
  const c=announcementsCoordinates();
  if(!c)return {live:false,probe:"hls",status:"invalid-url",error:"Invalid stream URL",durationMs:0,attempts:[]};
  const started=Date.now(),stamp=started,attempts=[];
  const primary=`${c.origin}/${c.app}/streams/${encodeURIComponent(c.id)}.m3u8?_=${stamp}`;
  const adaptive=`${c.origin}/${c.app}/streams/${encodeURIComponent(c.id)}_adaptive.m3u8?_=${stamp}`;
  for(const [index,url] of [primary,adaptive].entries()){
    try{
      const r=await fetchWithDeadline(url,{},3500);
      if(r.status===404){
        attempts.push({probe:index===0?"hls":"hls-adaptive",httpStatus:404,ok:false,url,status:"not-found"});
        // This Ant Media deployment creates the primary manifest while a publisher
        // is live and removes it when publishing stops. Primary 404 is authoritative OFFLINE.
        if(index===0)return {live:false,probe:"hls",status:"404-offline",httpStatus:404,url,durationMs:Date.now()-started,attempts};
        continue;
      }
      if(!r.ok){
        attempts.push({probe:index===0?"hls":"hls-adaptive",httpStatus:r.status,ok:false,url,status:`http-${r.status}`});
        continue;
      }
      const text=await r.text();
      const valid=text.startsWith("#EXTM3U")&&(text.includes("#EXTINF")||text.includes("#EXT-X-STREAM-INF"));
      attempts.push({probe:index===0?"hls":"hls-adaptive",httpStatus:r.status,ok:valid,url,status:valid?"playlist":"invalid-playlist"});
      if(valid){
        const seq=(text.match(/#EXT-X-MEDIA-SEQUENCE:(\\d+)/)||[])[1]||null;
        return {live:true,probe:"hls",status:"playlist",httpStatus:r.status,url,mediaSequence:seq,durationMs:Date.now()-started,attempts};
      }
    }catch(err){
      attempts.push({probe:index===0?"hls":"hls-adaptive",ok:false,url,error:err?.name==='AbortError'?"timeout":String(err?.message||err)});
    }
  }
  // Network/proxy failures are UNKNOWN, not OFFLINE, so they do not consume
  // the two-confirmation stream-ended guard.
  return {live:null,probe:"hls",status:"unavailable",error:"HLS probe unavailable",durationMs:Date.now()-started,attempts};
}
'''
s = s[:start] + new_probe + s[end:]

old_tick = '''    if(probe.live){
      morningAnnouncementsRuntime.live=true;morningAnnouncementsRuntime.offlineCount=0;
      if(!morningAnnouncementsRuntime.active||Date.now()-morningAnnouncementsRuntime.lastAssertAt>30000)await assertMorningAnnouncements({mode:"automatic"});
    }else{
      morningAnnouncementsRuntime.live=false;morningAnnouncementsRuntime.offlineCount++;
      if(morningAnnouncementsRuntime.active&&morningAnnouncementsRuntime.offlineCount>=morningAnnouncements.offlineConfirmations)await releaseMorningAnnouncements("stream-ended");
    }
'''
new_tick = '''    if(probe.live===true){
      morningAnnouncementsRuntime.live=true;morningAnnouncementsRuntime.offlineCount=0;
      if(!morningAnnouncementsRuntime.active||Date.now()-morningAnnouncementsRuntime.lastAssertAt>30000)await assertMorningAnnouncements({mode:"automatic"});
    }else if(probe.live===false){
      morningAnnouncementsRuntime.live=false;morningAnnouncementsRuntime.offlineCount++;
      if(morningAnnouncementsRuntime.active&&morningAnnouncementsRuntime.offlineCount>=morningAnnouncements.offlineConfirmations)await releaseMorningAnnouncements("stream-ended");
    }else{
      morningAnnouncementsRuntime.lastError=probe.error||"HLS probe unavailable";
    }
'''
if old_tick not in s:
    raise SystemExit("Expected morning announcements watcher block not found")
s = s.replace(old_tick, new_tick, 1)

old_check = '''    morningAnnouncementsRuntime.live=!!probe.live;
    if(probe.live){
      morningAnnouncementsRuntime.offlineCount=0;
      morningAnnouncementsRuntime.lastLiveAt=morningAnnouncementsRuntime.lastCheck;
    }else if(morningAnnouncementsRuntime.active){
      morningAnnouncementsRuntime.offlineCount++;
    }else{
      morningAnnouncementsRuntime.offlineCount=0;
    }
'''
new_check = '''    if(probe.live===true){
      morningAnnouncementsRuntime.live=true;
      morningAnnouncementsRuntime.offlineCount=0;
      morningAnnouncementsRuntime.lastLiveAt=morningAnnouncementsRuntime.lastCheck;
    }else if(probe.live===false){
      morningAnnouncementsRuntime.live=false;
      if(morningAnnouncementsRuntime.active)morningAnnouncementsRuntime.offlineCount++;
      else morningAnnouncementsRuntime.offlineCount=0;
    }
'''
if old_check not in s:
    raise SystemExit("Expected manual live-check block not found")
s = s.replace(old_check, new_check, 1)
SERVER.write_text(s)

# Keep all embedded runtime/build identifiers converged.
for rel in [
    "VERSION", "package.json", "README.md", "public/controller/index.html",
    "public/controller/display.html", "public/display/index.html",
    "maintenance-agent/package.json", "maintenance-agent/server.js", "host-agent/server.py",
]:
    p = ROOT / rel
    if p.exists():
        p.write_text(p.read_text().replace("1.0.0-alpha.64", "1.0.0-alpha.65"))

# server.js has multiple embedded version checks/log strings.
SERVER.write_text(SERVER.read_text().replace("1.0.0-alpha.64", "1.0.0-alpha.65"))

changelog = ROOT / "CHANGELOG.md"
t = changelog.read_text()
entry = '''## 1.0.0-alpha.65\n\n- Make Ant Media HLS the authoritative Morning Announcements live/offline probe.\n- Treat primary HLS HTTP 200 plus a valid playlist as LIVE and HTTP 404 as OFFLINE.\n- Stop treating blocked REST/WebRTC probes as stream-state evidence.\n- Treat network/proxy failures as UNKNOWN so transient failures do not consume offline confirmations.\n- Preserve two confirmed OFFLINE checks before automatic release.\n- Report HLS media sequence when available for diagnostics.\n\n'''
if "## 1.0.0-alpha.65" not in t:
    if t.startswith("# Changelog\n\n"):
        t = "# Changelog\n\n" + entry + t[len("# Changelog\n\n"):]
    else:
        t = entry + t
    changelog.write_text(t)

print("Applied alpha.65 HLS live-watch update")
