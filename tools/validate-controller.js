#!/usr/bin/env node
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const file=process.argv[2]||path.join('public','controller','index.html');
const html=fs.readFileSync(file,'utf8');
const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if(!blocks.length){console.error(`No inline <script> blocks found in ${file}`);process.exit(2)}
let checked=0;
for(let i=0;i<blocks.length;i++){
  const full=blocks[i][0];
  if(/<script[^>]+\bsrc\s*=/.test(full))continue;
  try{new vm.Script(blocks[i][1],{filename:`${file}#script-${i+1}`});checked++}
  catch(err){console.error(`Controller JavaScript syntax validation failed in script block ${i+1}:`);console.error(err.stack||err);process.exit(1)}
}
console.log(`Controller JavaScript syntax OK (${checked} inline script block${checked===1?'':'s'}).`);

const forbidden=['loadBackups','loadDocker'];
for(const name of forbidden){if(new RegExp(`\\b${name}\\s*\\(`).test(html)){console.error(`Controller runtime symbol regression detected: ${name}()`);process.exit(1)}}
const required=['loadManagedBackups','loadManagedContainers','loadHostHealth','loadRecoveryRetention','applyRecoveryRetention','installUbuntuUpdates'];
for(const name of required){if(!new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(html)){console.error(`Required controller function missing: ${name}()`);process.exit(1)}}
console.log('Controller runtime symbol regression checks OK.');
