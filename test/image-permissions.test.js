"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {verifyPath} = require("../tools/verify-image-permissions");
const root = path.resolve(__dirname, "..");

test("image normalizes packaged modes and verifies readability after dropping root", () => {
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
  const normalize = dockerfile.indexOf("RUN chmod 0755 /app");
  const user = dockerfile.indexOf("USER 10001:10001");
  const verify = dockerfile.indexOf("RUN node tools/verify-image-permissions.js");
  assert.ok(normalize > dockerfile.indexOf("COPY --from=browser-build"));
  assert.ok(user > normalize && verify > user);
  assert.match(dockerfile, /find \/app\/src \/app\/public \/app\/config \/app\/tools -type d -exec chmod 0755/);
  assert.match(dockerfile, /find \/app\/src \/app\/public \/app\/config \/app\/tools -type f -exec chmod 0644/);
  assert.doesNotMatch(dockerfile, /chmod\s+-R\s+(?:777|a\+rwx)/);
});

test("packaged permissions verifier rejects private, writable and symlinked source", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hub-image-permissions-"));
  const file = path.join(work, "server.js");
  const stat = fs.statSync(work);
  try {
    fs.chmodSync(work, 0o755);
    fs.writeFileSync(file, "// non-secret test fixture\n", {mode: 0o644});
    verifyPath(work, stat.uid, stat.gid);
    for (const mode of [0o600, 0o666, 0o777]) {
      fs.chmodSync(file, mode);
      assert.throws(() => verifyPath(work, stat.uid, stat.gid), /Unexpected packaged permissions/);
    }
    fs.chmodSync(file, 0o644);
    fs.symlinkSync(file, path.join(work, "link.js"));
    assert.throws(() => verifyPath(work, stat.uid, stat.gid), /Unexpected file type/);
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
});

test("installer marker is ignored without hiding source or secret-file policy", () => {
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\/\.classroom-hub-installation$/m);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^data\/$/m);
  assert.doesNotMatch(ignore, /^src\/$/m);
});
