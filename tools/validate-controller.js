#!/usr/bin/env node
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const file=process.argv[2]||path.join('public','controller','index.html');
const html=fs.readFileSync(file,'utf8');
const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if(!blocks.length){console.error(`No <script> blocks found in ${file}`);process.exit(2)}
let checked=0;
let source=html;
for(let i=0;i<blocks.length;i++){
  const full=blocks[i][0];
  const src=full.match(/<script[^>]+\bsrc=["']([^"']+)["']/i)?.[1];
  let js=blocks[i][1],label=`${file}#script-${i+1}`;
  if(src){
    if(!src.startsWith('/controller/'))continue;
    label=path.join(path.dirname(file),path.basename(src));
    js=fs.readFileSync(label,'utf8');
    source+=`\n${js}`;
  }
  try{new vm.Script(js,{filename:label});checked++}
  catch(err){console.error(`Controller JavaScript syntax validation failed in script block ${i+1}:`);console.error(err.stack||err);process.exit(1)}
}
console.log(`Controller JavaScript syntax OK (${checked} controller script${checked===1?'':'s'}).`);

const forbidden=['loadBackups','loadDocker'];
for(const name of forbidden){if(new RegExp(`\\b${name}\\s*\\(`).test(source)){console.error(`Controller runtime symbol regression detected: ${name}()`);process.exit(1)}}
const required=['loadManagedBackups','loadManagedContainers','loadHostHealth','loadRecoveryRetention','applyRecoveryRetention','installUbuntuUpdates'];
for(const name of required){if(!new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(source)){console.error(`Required controller function missing: ${name}()`);process.exit(1)}}
console.log('Controller runtime symbol regression checks OK.');
