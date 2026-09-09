'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','public','shared','display-autofit.js'),'utf8');
const branding=fs.readFileSync(path.join(__dirname,'..','public','shared','branding.js'),'utf8');

test('display renderer loads intelligent auto-grow fitting',()=>{
  assert.match(branding,/\/shared\/display-autofit\.js/);
  assert.match(source,/CAPS=Object\.freeze\(\{title:118,subtitle:82,body:190,timer:132\}\)/);
});

test('all four logical components maximize readable size inside bounded regions',()=>{
  assert.match(source,/largestFit\(title,titleRegion,CAPS\.title,20\)/);
  assert.match(source,/largestFit\(subtitle,subtitleRegion,CAPS\.subtitle,16\)/);
  assert.match(source,/largestFit\(body,bodyRegion,CAPS\.body,MIN_FONT\)/);
  assert.match(source,/fitTimer\(timer\)/);
});

test('timer settles before body fitting and reserves body space',()=>{
  const timer=source.indexOf('fitTimer(timer);');
  const reserve=source.indexOf('reserveBodyForTimer(bodyRegion,timer);');
  const body=source.indexOf('largestFit(body,bodyRegion,CAPS.body,MIN_FONT);');
  assert.ok(timer>=0&&reserve>timer&&body>reserve);
});

test('physical resolution and DPR are absent from fitting algorithm',()=>{
  assert.doesNotMatch(source,/devicePixelRatio|screen\.width|screen\.height/);
});
