
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
  // Support both the canonical /display/<id> receiver URL and the legacy
  // static-page form /display/?id=<id>. Setup/enrollment links have used both.
  const raw=m?.[1]||new URLSearchParams(location.search).get("id")||"";
  try{return decodeURIComponent(raw).trim().toLowerCase()}catch{return ""}
}
