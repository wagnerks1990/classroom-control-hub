"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

test("production installer pulls commit-matched CI images by default",()=>{
  const source=fs.readFileSync("install.sh","utf8");
  assert.match(source,/INSTALL_MODE=pull/);
  assert.match(source,/IMAGE_TAG="sha-\$\{SOURCE_COMMIT\}"/);
  assert.match(source,/docker pull "\$HUB_IMAGE"/);
  assert.match(source,/docker pull "\$MAINT_IMAGE"/);
  assert.match(source,/roomgoblin_verify_image_revision "\$HUB_IMAGE" "\$SOURCE_COMMIT"/);
  assert.match(source,/roomgoblin_verify_image_revision "\$MAINT_IMAGE" "\$SOURCE_COMMIT"/);
  assert.ok(source.indexOf('docker pull "$HUB_IMAGE"')<source.indexOf('Creating pre-migration backup'),"images must be available before backup or migration mutations");
  assert.match(source,/--build-local/);
  assert.match(source,/docker compose up -d --no-build/);
});

test("web-managed releases pull matching immutable images",()=>{
  const source=fs.readFileSync("host-agent/app-update-runner.sh","utf8");
  assert.match(source,/IMAGE_TAG="\$TARGETREF"/);
  assert.match(source,/docker pull "\$HUB_IMAGE"/);
  assert.match(source,/docker pull "\$MAINTENANCE_IMAGE"/);
  assert.match(source,/roomgoblin_verify_image_revision "\$HUB_IMAGE" "\$RESOLVED"/);
  assert.match(source,/roomgoblin_verify_image_revision "\$MAINTENANCE_IMAGE" "\$RESOLVED"/);
  assert.doesNotMatch(source,/docker compose build --pull classroom-hub maintenance-agent/);
});

test("validated main images publish under canonical and legacy aliases",()=>{
  const main=fs.readFileSync(".github/workflows/publish-main-images.yml","utf8");
  for(const image of ["roomgoblin","roomgoblin-maintenance","classroom-control-hub","classroom-control-hub-maintenance"])
    assert.match(main,new RegExp(`ghcr\\.io/wagnerks1990/${image}`));
  const releases=fs.readFileSync(".github/workflows/docker-publish.yml","utf8");
  assert.match(main,/org\.opencontainers\.image\.revision=\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(releases,/ghcr\.io\/\$\{\{ github\.repository \}\}/);
  assert.match(releases,/ghcr\.io\/wagnerks1990\/classroom-control-hub/);
  assert.match(releases,/ghcr\.io\/\$\{\{ github\.repository \}\}-maintenance/);
  assert.match(releases,/ghcr\.io\/wagnerks1990\/classroom-control-hub-maintenance/);
});

test("image identity rejects a correct-version image built from another commit",t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-image-identity-"));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const fakeDocker=path.join(temp,"docker");
  fs.writeFileSync(fakeDocker,"#!/bin/sh\nprintf '%s\\n' \"$FAKE_IMAGE_REVISION\"\n");
  fs.chmodSync(fakeDocker,0o755);
  const expected="a".repeat(40),run=revision=>spawnSync("bash",["-c",`. deploy/image-identity.sh; roomgoblin_verify_image_revision ghcr.io/wagnerks1990/roomgoblin:v1.0.0-alpha.80 ${expected}`],{encoding:"utf8",env:{...process.env,PATH:`${temp}:${process.env.PATH}`,FAKE_IMAGE_REVISION:revision}});
  assert.equal(run(expected).status,0);
  const wrong=run("b".repeat(40));
  assert.notEqual(wrong.status,0);
  assert.match(wrong.stderr,/source revision mismatch/);
});

test("main image publication waits for all independent validation jobs",()=>{
  const workflow=fs.readFileSync(".github/workflows/publish-main-images.yml","utf8");
  assert.match(workflow,/checks: read/);
  for(const name of ["Validate","Display browser regression","Android TV Display Agent","Restrictive image permissions"])
    assert.ok(workflow.includes(name),`missing workflow-identity gate: ${name}`);
  assert.match(workflow,/state="\$\(jq -r/);
  assert.match(workflow,/failure\|cancelled\|timed_out\|action_required\|stale\|skipped/);
  assert.match(workflow,/group: publish-main-images-\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow,/cancel-in-progress: false/);
});

test("mutable alpha aliases have one guarded owner after both immutable images publish",()=>{
  const main=fs.readFileSync(".github/workflows/publish-main-images.yml","utf8");
  assert.match(main,/promote:/);
  assert.match(main,/needs: build/);
  assert.match(main,/group: publish-main-alpha-promotion/);
  assert.match(main,/current_main_sha=.*git\/ref\/heads\/main/);
  assert.match(main,/current_main_sha.*VALIDATED_SHA/);
  assert.match(main,/docker buildx imagetools create/);
  const buildSection=main.slice(0,main.indexOf("\n  promote:"));
  assert.doesNotMatch(buildSection,/value=alpha|\}:alpha/);

  const release=fs.readFileSync(".github/workflows/docker-publish.yml","utf8");
  assert.doesNotMatch(release,/value=alpha|\}:alpha|publish-main-alpha-promotion/);
});

test("dependency audits block moderate and higher findings",()=>{
  for(const file of [".github/workflows/validate.yml",".github/workflows/docker-publish.yml"]){
    const workflow=fs.readFileSync(file,"utf8");
    assert.doesNotMatch(workflow,/audit-level=high/);
    assert.match(workflow,/audit-level=moderate/);
  }
});

test("standalone production update delegates to the supported installer",()=>{
  const source=fs.readFileSync("deploy/update-production.sh","utf8");
  assert.match(source,/exec bash "\$ROOT\/install\.sh"/);
  assert.doesNotMatch(source,/docker compose up/);
});

test("database cutover fails closed when a running application cannot stop",()=>{
  const source=fs.readFileSync("install.sh","utf8");
  assert.match(source,/docker ps -a --format .* \|\| fail "Cannot inspect Docker/);
  assert.match(source,/docker compose stop classroom-hub\) \|\| fail/);
  assert.match(source,/refusing database cutover/);
});

test("application rollback persists images and restores the prior image tag",()=>{
  const source=fs.readFileSync("host-agent/app-update-runner.sh","utf8");
  assert.match(source,/set_request_fields "rollbackHubImage=/);
  assert.match(source,/set_image_tag "\$CURRENT_IMAGE_TAG"/);
  assert.match(source,/set_image_tag "\$PREVIOUSIMAGETAG"/);
});

test("installer and web updater preserve an explicit trusted-proxy hop count",()=>{
  const installer=fs.readFileSync("install.sh","utf8");
  const updater=fs.readFileSync("host-agent/app-update-runner.sh","utf8");
  for(const source of [installer,updater]){
    assert.match(source,/TRUST_PROXY_HOPS must be an integer between 0 and 8/);
    assert.doesNotMatch(source,/sed -i ['"]s\/\^TRUST_PROXY_HOPS=.*TRUST_PROXY_HOPS=0/);
  }
});
