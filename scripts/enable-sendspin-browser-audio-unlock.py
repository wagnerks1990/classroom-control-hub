from pathlib import Path

p = Path('public/display/index.html')
s = p.read_text()

needle = "function maFriendlyName(){return id==='tv5'?'Classroom Control Hub - Hallway Display':`Classroom Control Hub - ${id.toUpperCase()}`}\n"
insert = needle + """let maAudioUnlocked=false;
async function unlockMusicAssistantAudio(){
  const player=maSendspinPlayer;
  if(!player||typeof player.unlock!=='function')return false;
  try{
    await player.unlock();
    maAudioUnlocked=true;
    reportMusicAssistantStatus({audioLocked:false,audioUnlocked:true,error:null});
    console.info('Music Assistant TV audio unlocked by user gesture');
    return true;
  }catch(e){
    reportMusicAssistantStatus({audioLocked:true,audioUnlocked:false,error:String(e?.message||e)});
    console.warn('Music Assistant TV audio unlock failed',e);
    return false;
  }
}
window.classroomHubUnlockAudio=unlockMusicAssistantAudio;
for(const eventName of ['pointerdown','touchstart','keydown']){
  window.addEventListener(eventName,()=>{if(!maAudioUnlocked&&maSendspinPlayer)unlockMusicAssistantAudio()}, {passive:true});
}
"""
if needle not in s:
    raise SystemExit('Expected maFriendlyName block not found')
s = s.replace(needle, insert, 1)

# Surface that audio is initially locked until a browser gesture unlocks it.
s = s.replace("protocolActive:false,audioLocked:false,error:null", "protocolActive:false,audioLocked:!maAudioUnlocked,error:null", 1)

p.write_text(s)
print('Added Sendspin browser audio unlock support. After reload, click/tap the display once or call window.classroomHubUnlockAudio() from the console.')
