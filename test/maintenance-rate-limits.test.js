"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../maintenance-agent/server.js"), "utf8");

test("maintenance mutation limiter follows authentication and precedes every route", () => {
  const auth = source.indexOf("app.use(auth);");
  const limiter = source.indexOf("app.use(rateLimit({");
  const firstRoute = source.indexOf('app.get("/health"');
  const deployment = source.indexOf('app.post("/modules/:id/deploy"');
  assert.ok(auth >= 0 && limiter > auth && firstRoute > limiter && deployment > limiter);
  assert.match(source, /const \{rateLimit\}=require\("express-rate-limit"\)/);
});

test("maintenance budget is global, bounded, and excludes only read methods", () => {
  // Evaluate only the checked-in options object. The Docker smoke test exercises
  // the real middleware, HTTP 429, Retry-After and extension-wrapped routes.
  const match = source.match(/app\.use\(rateLimit\((\{[\s\S]*?\n\})\)\);/);
  assert.ok(match);
  const options = vm.runInNewContext(`(${match[1]})`, Object.create(null), {timeout:1000});
  assert.equal(options.windowMs, 60_000);
  assert.equal(options.limit, 30);
  assert.equal(options.legacyHeaders, false);
  assert.equal(options.standardHeaders, "draft-8");
  for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(options.skip({method}), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(options.skip({method}), false);
  assert.equal(options.keyGenerator({ip:"127.0.0.1"}), options.keyGenerator({ip:"127.0.0.2",headers:{"x-forwarded-for":"198.51.100.99"}}));
  assert.equal(options.message.ok, false);
});
