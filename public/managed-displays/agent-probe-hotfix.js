"use strict";

// Android /system/bin/sh compatibility guard.
// Keep installation and running-state probes branchless because commands sent
// through ADB shell + sh -c can be reparsed by the device shell. Compound
// if/then grammar has regressed on validated Onn Android 14 hardware.
window.probeAgent=async function probeAgent(id,rerender=true){
  const d=deviceById(id);
  if(!d)return null;
  if(!state.adbAvailable){d.agentStatus={error:"ADB bridge unavailable"};if(rerender)render();return d.agentStatus}
  if(d.lastStatus?.online!==true||d.uiRecovering){d.agentStatus={error:d.uiRecovering?"device recovering":"device offline"};if(rerender)render();return d.agentStatus}
  try{
    const pkg=d.agentPackage||"org.classroomhub.display";
    const script=`pm path ${pkg} 2>/dev/null | grep -q '^package:' && echo INSTALLED=1 || echo INSTALLED=0; pidof ${pkg} >/dev/null 2>&1 && echo RUNNING=1 || echo RUNNING=0`;
    const j=await runShell(id,script,8000);
    d.agentStatus=parseAgentProbe(j.stdout||"");
  }catch(e){d.agentStatus={error:e.message}}
  if(rerender)render();
  return d.agentStatus;
};
