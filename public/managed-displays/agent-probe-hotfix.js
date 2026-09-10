"use strict";

// Agent status is intentionally fetched from a dedicated maintenance endpoint.
// Do not reconstruct this probe with remote `sh -c` scripts: ADB reparses shell
// arguments on some Android builds and can corrupt compound commands.
window.probeAgent=async function probeAgent(id,rerender=true){
  const d=deviceById(id);
  if(!d)return null;
  if(!state.adbAvailable){d.agentStatus={error:"ADB bridge unavailable"};if(rerender)render();return d.agentStatus}
  if(d.lastStatus?.online!==true||d.uiRecovering){d.agentStatus={error:d.uiRecovering?"device recovering":"device offline"};if(rerender)render();return d.agentStatus}
  try{
    const j=await api(`/android/devices/${encodeURIComponent(id)}/agent/status`);
    d.agentStatus={installed:j.installed===true,running:j.running===true,version:j.version||""};
  }catch(e){d.agentStatus={error:e.message}}
  if(rerender)render();
  return d.agentStatus;
};
