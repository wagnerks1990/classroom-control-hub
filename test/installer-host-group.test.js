"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname, "..");

function preflight(mode) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hub-group-test-"));
  try {
    const result = spawnSync("bash", ["-c", `
set -euo pipefail
getent(){
  [[ "$1" == group ]] || return 1
  if [[ "$MODE" == lookup-error ]]; then return 1; fi
  if [[ "$2" == 10001 ]]; then
    case "$MODE" in
      existing) echo 'classroom-hub:x:10001:'; return 0;;
      renamed) echo 'existing-hub-group:x:10001:'; return 0;;
      malformed) echo 'wrong:x:10002:'; return 0;;
    esac
    if [[ -e "$WORK/created" ]]; then
      [[ "$MODE" != invisible ]] || return 2
      echo 'classroom-hub:x:10001:'; return 0
    fi
  elif [[ "$2" == classroom-hub ]]; then
    case "$MODE" in
      collision) echo 'classroom-hub:x:7777:'; return 0;;
      name-error) return 1;;
    esac
  fi
  return 2
}
groupadd(){
  printf '%s\\n' "$*" >> "$WORK/calls"
  [[ "$MODE" != create-error ]] || return 10
  touch "$WORK/created"
}
source "$ROOT/deploy/host-group.sh"
# Two calls prove idempotence without touching the real host group database.
ensure_hub_install_group
ensure_hub_install_group
`], {encoding:"utf8", env:{...process.env, ROOT:root, WORK:work, MODE:mode}});
    assert.ifError(result.error);
    return {...result, calls:fs.existsSync(path.join(work,"calls")) ? fs.readFileSync(path.join(work,"calls"),"utf8") : ""};
  } finally { fs.rmSync(work, {recursive:true, force:true}); }
}

test("missing host GID is created exactly once with a fixed ID and no members", () => {
  const result = preflight("missing");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "classroom-hub\nclassroom-hub\n");
  assert.equal(result.calls, "--system --gid 10001 classroom-hub\n");
});
for (const [mode,name] of [["existing","classroom-hub"],["renamed","existing-hub-group"]]) {
  test(`existing host GID is reused without account changes: ${mode}`, () => {
    const result = preflight(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${name}\n${name}\n`);
    assert.equal(result.calls, "");
  });
}
for (const mode of ["collision","lookup-error","name-error","malformed"]) {
  test(`host group preflight fails closed without changes: ${mode}`, () => {
    const result = preflight(mode);
    assert.notEqual(result.status, 0);
    assert.equal(result.calls, "");
    assert.equal(result.stdout, "");
  });
}
for (const mode of ["create-error","invisible"]) {
  test(`host group creation failure prevents installation: ${mode}`, () => {
    const result = preflight(mode);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  });
}
test("installer resolves host group before backups, data and key operations", () => {
  const installer = fs.readFileSync(path.join(root,"install.sh"), "utf8");
  const preflight = installer.indexOf('HUB_INSTALL_GROUP="$(ensure_hub_install_group)"');
  assert.ok(preflight > installer.indexOf('if [[ $EUID -ne 0 ]]'));
  assert.ok(preflight < installer.indexOf('mkdir -p "$BACKUP_ROOT"'));
  assert.ok(preflight < installer.indexOf('chown -R 10001:10001'));
  assert.match(installer, /source "\$SOURCE\/deploy\/host-group\.sh"/);
  assert.doesNotMatch(installer, /install[^\n]*-g 10001\b/);
  assert.match(installer, /install -d -m 0750 -o root -g "\$HUB_INSTALL_GROUP"/);
  assert.match(installer, /install -m 0640 -o root -g "\$HUB_INSTALL_GROUP"/);
});
