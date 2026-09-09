"use strict";
// Verify packaged files only. Do not open mounted databases, .env, or keys.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

function verifyPath(filename, owner = 0, group = 0) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isDirectory() || stat.isFile(), `Unexpected file type: ${filename}`);
  assert.equal(stat.uid, owner, `Unexpected owner: ${filename}`);
  assert.equal(stat.gid, group, `Unexpected group: ${filename}`);
  assert.equal(stat.mode & 0o7777, stat.isDirectory() ? 0o755 : 0o644,
    `Unexpected packaged permissions: ${filename}`);
  if (stat.isDirectory()) {
    fs.accessSync(filename, fs.constants.R_OK | fs.constants.X_OK);
    for (const name of fs.readdirSync(filename)) verifyPath(path.join(filename, name), owner, group);
  } else {
    // An actual open catches access failures, not just unexpected mode bits.
    const fd = fs.openSync(filename, "r");
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  assert.equal(process.getuid(), 10001, "Run the image check as the application UID, not root");
  assert.equal(process.getgid(), 10001, "Run the image check as application GID 10001");
  for (const item of ["src", "public", "config", "tools", "VERSION", "package.json", "package-lock.json"]) {
    verifyPath(path.join("/app", item));
  }
  console.log("Packaged application files are readable by UID/GID 10001 and remain root-owned (0644/0755).");
}
module.exports = {verifyPath};
