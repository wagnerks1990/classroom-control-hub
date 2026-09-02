
export function wsUrl(){
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws`;
}
export function api(path, options={}){
  return fetch(path, options).then(async r=>{
    const t = await r.text();
    let j;
    try{ j = JSON.parse(t); } catch { j = {raw:t}; }
    if(!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });
}
export function getDisplayId(){
  const m = location.pathname.match(/\/display\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}
