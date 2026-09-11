"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

test("production installer pulls commit-matched CI images by default",()=>{
  const source=fs.readFileSync("install.sh","utf8");
  assert.match(source,/INSTALL_MODE=pull/);
  assert.match(source,/IMAGE_TAG="sha-\$\{SOURCE_COMMIT\}"/);
  assert.match(source,/docker pull "\$HUB_IMAGE"/);
  assert.match(source,/docker pull "\$MAINT_IMAGE"/);
  assert.match(source,/--build-local/);
  assert.match(source,/docker compose up -d --no-build/);
});

test("web-managed releases pull matching immutable images",()=>{
  const source=fs.readFileSync("host-agent/app-update-runner.sh","utf8");
  assert.match(source,/IMAGE_TAG="\$TARGETREF"/);
  assert.match(source,/docker pull "\$HUB_IMAGE"/);
  assert.match(source,/docker pull "\$MAINTENANCE_IMAGE"/);
  assert.doesNotMatch(source,/docker compose build --pull classroom-hub maintenance-agent/);
});
