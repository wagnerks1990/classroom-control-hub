"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Morning Announcements controller loads the saved URL without mutating configuration",()=>{
  const source=read("public/controller/display.html");
  assert.match(source,/if\(!raw\)throw new Error\('Configure a Morning Announcements stream URL/);
  const loader=source.slice(source.indexOf("async function loadMorningAnnouncementSettings"),source.indexOf("setTimeout(loadMorningAnnouncementSettings"));
  assert.match(loader,/x\.config\?\.streamUrl\|\|x\.playbackUrl/);
  assert.match(loader,/paintMorningAnnouncementVolume\(v\)/);
  assert.doesNotMatch(loader,/method:'PUT'/);
  assert.doesNotMatch(source,/loadMorningAnnouncementVolume/);
});

test("Morning Announcements telemetry strips URL queries, fragments, and the private media key",()=>{
  const player=read("public/antmedia-player/index.html");
  const fn=player.match(/function safeTelemetryUrl\(value\)\{[^\n]+\}/)?.[0];
  assert.ok(fn,"Ant Media telemetry URL sanitizer must exist");
  const context={URL};vm.createContext(context);vm.runInContext(`${fn};this.sanitize=safeTelemetryUrl`,context);
  assert.equal(context.sanitize("https://video.example/LiveApp/play.html?id=morning&token=secret#fragment"),"https://video.example/LiveApp/play.html");
  assert.match(player,/payload\.url=safeTelemetryUrl\(payload\.url\);payload\.source=safeTelemetryUrl\(payload\.source\)/);

  const receiver=read("public/shared/attribution.js");
  assert.match(receiver,/const \{key:_privateMediaKey,\.\.\.publicStream\}=stream/);
  assert.match(receiver,/player:stream\.player\?\{\.\.\.stream\.player,url:safeTelemetryUrl\(stream\.player\.url\),source:safeTelemetryUrl\(stream\.player\.source\)\}:null/);
  assert.match(receiver,/update=\{\.\.\.raw,url:safeTelemetryUrl\(raw\.url\),source:safeTelemetryUrl\(raw\.source\)\}/);
});

test("Veyon login collects passwords in a clearing password dialog",()=>{
  const source=read("public/controller/veyon.html");
  assert.match(source,/<dialog id="loginDialog"/);
  assert.match(source,/id="veyonLoginPassword" type="password"/);
  assert.match(source,/\$\('veyonLoginPassword'\)\.value=''/);
  assert.match(source,/\$\('loginDialog'\)\.addEventListener\('close',clearVeyonLogin\)/);
  assert.doesNotMatch(source,/prompt\('Password/);
});

test("manual display media sends the selected TV-local loading policy",()=>{
  const source=read("public/controller/display.html");
  assert.match(source,/id="mediaLocalDirect" type="checkbox"/);
  assert.match(source,/localDirect:el\('mediaLocalDirect'\)\.checked/);
});

function unnamedStaticControls(source){
  const controls=[],labelFors=new Set();let labelDepth=0;
  for(const match of source.matchAll(/<\/?(?:label|input|select|textarea)\b[^>]*>/gi)){
    const tag=match[0],closing=/^<\//.test(tag),name=(tag.match(/^<\/?([a-z]+)/i)||[])[1]?.toLowerCase();
    if(name==='label'){
      if(closing){labelDepth=Math.max(0,labelDepth-1);continue}
      const target=(tag.match(/\bfor=["']([^"']+)["']/i)||[])[1];if(target)labelFors.add(target);
      labelDepth++;continue;
    }
    if(closing||name==='input'&&/\btype=["']hidden["']/i.test(tag))continue;
    const id=(tag.match(/\bid=["']([^"']+)["']/i)||[])[1]||'';
    const named=labelDepth>0||/\baria-label(?:ledby)?=["'][^"']+["']/i.test(tag);
    controls.push({id,named});
  }
  return controls.filter(control=>!control.named&&!labelFors.has(control.id));
}

test("static controller and setup form controls all have accessible names",()=>{
  for(const file of ["public/controller/index.html","public/controller/display.html","public/setup/index.html"]){
    assert.deepEqual(unnamedStaticControls(read(file)),[],file);
  }
});
