"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const network = require("../src/network");

test("host-mode aliases migrate exactly and preserve remote connections", () => {
  assert.equal(read("src/network.js"), read("maintenance-agent/network.js"));
  assert.equal(network.serviceUrl("mqtt://host.docker.internal:1884", [], "host"), "mqtt://127.0.0.1:1884");
  assert.equal(network.serviceUrl("http://music-assistant-server:8095/api", ["music-assistant-server"], "host"), "http://127.0.0.1:8095/api");
  assert.equal(network.serviceUrl("http://host.docker.internal:11080", [], "bridge"), "http://host.docker.internal:11080");
  for (const url of ["http://music.school.test:8095", "mqtt://broker.school.test:1883", "http://host.docker.internal.school.test:80", "", "not a url"]) {
    assert.equal(network.serviceUrl(url, [], "host"), url);
  }
  assert.equal(network.serviceHost("mosquitto", ["mosquitto"], "host"), "127.0.0.1");
  assert.equal(network.serviceHost("remote-broker", ["mosquitto"], "host"), "remote-broker");
});

test("actual listener ports and IP bindings drive internal health URLs", () => {
  assert.equal(network.localHttpUrl(3800, "0.0.0.0"), "http://127.0.0.1:3800");
  assert.equal(network.localHttpUrl(3800, "192.0.2.20"), "http://192.0.2.20:3800");
  assert.equal(network.localHttpUrl(3800, "::"), "http://[::1]:3800");
  assert.equal(network.localHttpUrl(3800, "2001:db8::1"), "http://[2001:db8::1]:3800");
  for (const port of [0, -1, 65536, "abc", 2.5]) assert.throws(() => network.validPort(port, 3000));
  assert.throws(() => network.localHttpUrl(3000, "example.com/path"));
  assert.equal(network.mainAppUrl({MAIN_APP_PORT:"3800", MAIN_APP_BIND_ADDRESS:"192.0.2.20"}), "http://192.0.2.20:3800");
  assert.equal(network.mainAppUrl({MAIN_APP_URL:"http://classroom-hub:3000", HUB_NETWORK_MODE:"host"}), "http://127.0.0.1:3000");
});

function addonHarness(t, exists = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-host-network-"));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const calls = [];
  const express = {application:{get(){}, post(){}}};
  const context = vm.createContext({
    require: name => name === "express" ? express : name === "./network" ? network : require(name),
    process:{env:{MANAGED_SERVICES_ROOT:dir,HUB_NETWORK_MODE:"host"}},
    Buffer, URL, AbortController, setTimeout, clearTimeout,
  });
  vm.runInContext(read("maintenance-agent/extensions.js"), context);
  context.containerExists = async () => exists;
  context.mainAppPut = async (_id, settings) => ({resolved:settings});
  context.hostAgentRequest = async args => {calls.push(Array.from(args)); return {ok:true, stdout:"test-container"};};
  return {context, calls, dir};
}

for (const [id, settings] of [
  ["mosquitto", {port:2883,username:"classroom-hub",password:"a-test-password-with-16-chars"}],
  ["govee2mqtt", {mqttHost:"host.docker.internal",mqttPort:2883}],
  ["musicassistant", {}],
]) {
  test(`managed ${id} deployment uses host networking without published ports`, async t => {
    const h = addonHarness(t);
    await h.context.deployAddon(id, settings, false);
    const args = h.calls.find(args => args[0] === "run");
    assert.ok(args);
    assert.equal(args.filter(value => value === "--network").length, 1);
    assert.equal(args[args.indexOf("--network") + 1], "host");
    assert.ok(!args.includes("-p") && !args.includes("--publish"));
    if (id === "mosquitto") assert.match(fs.readFileSync(path.join(h.dir,"mosquitto/config/mosquitto.conf"),"utf8"), /listener 2883\n/);
    if (id === "govee2mqtt") assert.ok(args.includes("GOVEE_MQTT_HOST=127.0.0.1"));
  });
}

test("adoption never removes an existing container or changes its network", async t => {
  const h = addonHarness(t, true);
  const result = await h.context.deployAddon("govee2mqtt", {}, false);
  assert.equal(result.adopted, true);
  assert.deepEqual(h.calls, []);
});

test("invalid recreation settings do not remove the existing broker", async t => {
  const h = addonHarness(t, true);
  await assert.rejects(h.context.deployAddon("mosquitto", {username:"hub",password:"a-test-password-with-16-chars",port:65536}, true), /Port/);
  assert.deepEqual(h.calls, []);
  assert.equal(fs.existsSync(path.join(h.dir,"mosquitto/config/mosquitto.conf")), false);
});

test("Host Agent rejects bridge defaults and published-port requests before Docker runs", () => {
  const result = spawnSync("python3", ["-c", `
import importlib.util
spec=importlib.util.spec_from_file_location('agent','host-agent/server.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
base=['run','-d','--name','mosquitto','--restart','unless-stopped']
image='eclipse-mosquitto:2.0.22'
a.validate_docker_run(base+['--network','host',image])
for extra in ([],['--network','bridge'],['--network','host','-p','1883:1883'],['--network','host','--network','host']):
    try: a.validate_docker_run(base+extra+[image])
    except RuntimeError: continue
    raise AssertionError('Unsafe network request accepted')
`], {cwd:root, encoding:"utf8"});
  assert.equal(result.status, 0, result.stderr);
});

test("rendered Compose preflight rejects stale bridge overrides, exposure and collisions", () => {
  const valid = {services:{
    "classroom-hub":{network_mode:"host",environment:{PORT:"3800",BIND_ADDRESS:"0.0.0.0",HUB_NETWORK_MODE:"host",MAINTENANCE_URL:"http://127.0.0.1:3810"}},
    "maintenance-agent":{network_mode:"host",environment:{PORT:"3810",BIND_ADDRESS:"127.0.0.1",HUB_NETWORK_MODE:"host"}},
  }};
  const run = config => spawnSync("python3", ["tools/validate-host-network.py"], {cwd:root, input:JSON.stringify(config), encoding:"utf8"});
  assert.equal(run(valid).status, 0);
  for (const mutate of [
    c => c.services["classroom-hub"].ports=[{target:3000,published:"3800"}],
    c => c.services["classroom-hub"].network_mode="bridge",
    c => c.services["maintenance-agent"].environment.BIND_ADDRESS="0.0.0.0",
    c => c.services["maintenance-agent"].environment.PORT="3800",
    c => c.services["classroom-hub"].environment.MAINTENANCE_URL="http://maintenance-agent:3010",
  ]) {const config=structuredClone(valid);mutate(config);assert.notEqual(run(config).status,0);}
});

test("core runtime and upgrade paths retain the host-network contract", () => {
  const compose = read("docker-compose.yml");
  assert.equal((compose.match(/network_mode: host/g)||[]).length, 2);
  assert.doesNotMatch(compose, /^\s*(ports|networks|extra_hosts):/m);
  assert.match(compose, /PORT: \$\{HUB_PORT:-3000\}/);
  assert.match(compose, /PORT: \$\{MAINTENANCE_PORT:-3010\}/);
  assert.match(read("maintenance-agent/server.js"), /BIND_ADDRESS="127\.0\.0\.1"/);
  assert.match(read("maintenance-agent/server.js"), /PORT=\$\{validPort\(resolved\.port,1880\)\}/);
  for (const file of ["host-agent/app-update-runner.sh","host-agent/update-runner.sh"]) {
    assert.doesNotMatch(read(file), /docker compose port/);
    assert.match(read(file), /process\.env\.BIND_ADDRESS/);
    assert.match(read(file), /docker compose exec -T classroom-hub/);
  }
  assert.match(read("public/controller/app.js"), /networkMigrationRequired/);
  assert.match(read("public/controller/app.js"), /Adoption does not change networking/);
  assert.match(read("public/controller/app.js"), /Host listeners \(no port mappings\)/);
  assert.match(read("host-agent/server.py"), /HOST_SERVICES_DIR/);
  assert.match(read("install.sh"), /Environment=HOST_SERVICES_DIR=\$SERVICES/);
  assert.match(read("install.sh"), /EnvironmentFile=-\$TARGET\/\.env/);
});

test("application updater force-recreates maintenance so new persistent mounts are applied", () => {
  const runner=read("host-agent/app-update-runner.sh");
  const compose=read("docker-compose.override.yml");
  assert.match(compose,/classroom-hub-android-adb:\/managed\/classroom-hub\/data\/android-tv\/\.android/);
  assert.match(runner,/docker compose up -d --no-build --force-recreate --remove-orphans maintenance-agent classroom-hub/);
  assert.match(runner,/adb_storage_check\(\)/);
  assert.match(runner,/docker volume inspect classroom-control-hub-android-adb/);
  assert.match(runner,/test -r \/managed\/classroom-hub\/data\/android-tv\/\.android/);
});

test("installer never changes tracked updater modes in the production checkout", () => {
  const installer=read("install.sh"),runner=read("host-agent/app-update-runner.sh");
  assert.doesNotMatch(installer,/chmod 0755 "\$TARGET\/host-agent\/update-runner\.sh"/);
  assert.doesNotMatch(runner,/chmod 0755 "\$HUB_ROOT\/host-agent\/update-runner\.sh"/);
  assert.match(installer,/install -D -m 0755 "\$TARGET\/host-agent\/app-update-runner\.sh" \/usr\/local\/libexec\/classroom-control-hub\/app-update-runner\.sh/);
});
