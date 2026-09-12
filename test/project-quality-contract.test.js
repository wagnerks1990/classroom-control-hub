"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("AI and Wiki guidance uses the executable managed-image allowlist",()=>{
  const guide=read("wiki/AI-and-Contributor-Guide.md");
  const catalog=JSON.parse(read("config/integrations.catalog.json"));
  const {FULL_RECOVERY_SERVICE_SPECS}=require("../maintenance-agent/backup-policy");
  const catalogImages=new Set(catalog.integrations.filter(x=>x.type==="docker").map(x=>x.image));
  const recoveryImages=new Set(Object.values(FULL_RECOVERY_SERVICE_SPECS).map(x=>x.image));
  assert.deepEqual(catalogImages,recoveryImages);
  for(const image of recoveryImages)assert.ok(guide.includes(image),`AI guide is missing ${image}`);
  assert.doesNotMatch(guide,/:latest\b/);
  assert.doesNotMatch(guide,/veyon\/webapi-proxy/);
  assert.match(guide,/Native `veyon\.service` and\s+`veyon-webapi\.service` are host-managed/);
});

test("security guidance preserves optional display authentication",()=>{
  for(const file of ["SECURITY.md","wiki/Security.md"]){
    const source=read(file);
    assert.match(source,/Stable URL access[^\n]+intentional default/);
    assert.match(source,/Where per-browser revocation is required, enroll every enabled receiver/);
    assert.doesNotMatch(source,/Provision each (?:classroom )?display/);
  }
});

test("every tracked shell script passes Bash syntax validation",()=>{
  const listed=spawnSync("git",["ls-files","*.sh"],{cwd:root,encoding:"utf8"});
  assert.equal(listed.status,0,listed.stderr);
  const scripts=listed.stdout.trim().split("\n").filter(Boolean);
  assert.ok(scripts.length>0);
  for(const script of scripts){
    const checked=spawnSync("bash",["-n",script],{cwd:root,encoding:"utf8"});
    assert.equal(checked.status,0,`${script}: ${checked.stderr}`);
  }
  const workflow=read(".github/workflows/validate.yml");
  assert.match(workflow,/git ls-files '\*\.sh'/);
});

test("release publication requires pinned security gates",()=>{
  const security=read(".github/workflows/security-gates.yml");
  assert.match(security,/fetch-depth: 0/);
  assert.match(security,/gitleaks\/gitleaks-action@[0-9a-f]{40}/);
  assert.match(security,/actions\/dependency-review-action@[0-9a-f]{40}/);
  assert.match(security,/fail-on-severity: moderate/);
  const validate=read(".github/workflows/validate.yml");
  assert.equal((validate.match(/aquasecurity\/trivy-action@[0-9a-f]{40}/g)||[]).length,2);
  assert.equal((validate.match(/severity: CRITICAL,HIGH/g)||[]).length,2);
  assert.equal((validate.match(/exit-code: '1'/g)||[]).length,2);
  assert.match(read(".github/workflows/publish-main-images.yml"),/Security gates/);
  assert.match(read(".github/workflows/docker-publish.yml"),/Security gates/);
  assert.match(read(".github/dependabot.yml"),/package-ecosystem: "gradle"/);
});

test("the downloaded Gradle distribution is checksum verified",()=>{
  const checksum="d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab";
  for(const file of [".github/workflows/android-tv-agent.yml","maintenance-agent/Dockerfile"]){
    const source=read(file);
    assert.ok(source.includes(checksum),`${file} lacks the reviewed Gradle 8.9 checksum`);
    assert.match(source,/sha256sum -c -/);
  }
});

test("runtime images exclude browser build tooling and the npm toolchain",()=>{
  const pkg=JSON.parse(read("package.json")),hub=read("Dockerfile"),maintenance=read("maintenance-agent/Dockerfile");
  assert.equal(pkg.dependencies.esbuild,undefined);
  assert.match(pkg.devDependencies.esbuild,/^\d+\.\d+\.\d+$/);
  assert.match(hub,/FROM node:22-bookworm-slim AS browser-build/);
  assert.match(hub,/npx --no-install esbuild/);
  assert.match(hub,/COPY --from=browser-build .*sendspin\.bundle\.js/);
  for(const source of [hub,maintenance]){
    assert.match(source,/rm -rf \/usr\/local\/lib\/node_modules\/npm/);
    assert.match(source,/rm -f \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/);
  }
});
