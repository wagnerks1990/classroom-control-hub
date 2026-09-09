"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const display = fs.readFileSync("public/display/index.html", "utf8");

test("display renderer uses one resolution-independent logical canvas", () => {
  assert.match(display, /const LOGICAL_WIDTH=1920,LOGICAL_HEIGHT=1080/);
  assert.match(display, /const scale=Math\.min\(m\.viewportWidth\/LOGICAL_WIDTH,m\.viewportHeight\/LOGICAL_HEIGHT\)/);
  assert.doesNotMatch(display, /viewportWidth\s*\*\s*m\.dpr|viewportHeight\s*\*\s*m\.dpr/);
});

test("display layout is coalesced into one animation-frame pass", () => {
  assert.match(display, /function requestDisplayLayout\(\)/);
  assert.match(display, /if\(layoutFrame!==null\)return/);
  assert.match(display, /layoutFrame=requestAnimationFrame\(\(\)=>\{layoutFrame=null;fitAllContent\(\)\}\)/);
});

test("timer geometry is finalized before body auto-fit", () => {
  const fit = display.match(/function fitAllContent\(\)\{([\s\S]*?)\n\}/);
  assert.ok(fit, "fitAllContent must exist");
  const body = fit[1];
  assert.ok(body.indexOf("fitTimer();") >= 0, "timer must be fitted");
  assert.ok(body.indexOf("reserveTextForTimer();") > body.indexOf("fitTimer();"), "timer must be measured before body reservation");
  assert.ok(body.indexOf("fitText(title") > body.indexOf("reserveTextForTimer();"));
  assert.ok(body.indexOf("fitText(subtitle") > body.indexOf("reserveTextForTimer();"));
  assert.ok(body.indexOf("fitText(text") > body.indexOf("reserveTextForTimer();"));
});

test("routine timer ticks do not trigger global layout", () => {
  assert.match(display, /setInterval\(\(\)=>paintTimer\(\{refit:false\}\),1000\)/);
});

test("renderer tracks four logical fitted components", () => {
  assert.match(display, /stage\.dataset\.layout=`title:\$\{title\.style\.fontSize\|\|''\};subtitle:\$\{subtitle\.style\.fontSize\|\|''\};body:\$\{text\.style\.fontSize\|\|''\};timer:\$\{timerOverlay\.style\.fontSize\|\|''\}`/);
});
