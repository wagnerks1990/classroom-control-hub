"use strict";

// This file is mirrored in src/ and maintenance-agent/ because the images have
// separate build contexts. A regression test prevents the copies from drifting.
const net = require("node:net");

function serviceHost(value, aliases = [], mode = process.env.HUB_NETWORK_MODE) {
  const host = String(value || "");
  return mode === "host" && ["host.docker.internal", ...aliases].includes(host.toLowerCase())
    ? "127.0.0.1" : host;
}

function serviceUrl(value, aliases = [], mode = process.env.HUB_NETWORK_MODE) {
  const raw = String(value || "").trim();
  if (mode !== "host" || !raw) return raw;
  try {
    const url = new URL(raw);
    const host = serviceHost(url.hostname, aliases, mode);
    if (host === url.hostname) return raw;
    url.hostname = host;
    // Do not manufacture a trailing slash for a previously bare HTTP endpoint.
    const result = url.toString();
    return !raw.endsWith("/") && result.endsWith("/") ? result.slice(0, -1) : result;
  } catch { return raw; } // Existing callers retain protocol/credential validation.
}

function validPort(value, fallback) {
  const port = Number(value == null || value === "" ? fallback : value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Port must be an integer from 1 to 65535");
  return port;
}

function localHttpUrl(port, bind = "127.0.0.1") {
  let host = String(bind || "127.0.0.1");
  if (host === "0.0.0.0") host = "127.0.0.1";
  if (host === "::" || host === "[::]") host = "::1";
  host = host.replace(/^\[|\]$/g, "");
  if (!net.isIP(host)) throw Error("Bind address must be an IPv4 or IPv6 address");
  return `http://${net.isIP(host) === 6 ? `[${host}]` : host}:${validPort(port, 3000)}`;
}

function mainAppUrl(env = process.env) {
  return env.MAIN_APP_URL
    ? serviceUrl(env.MAIN_APP_URL, ["classroom-hub", "classroom-control-hub"], env.HUB_NETWORK_MODE).replace(/\/$/, "")
    : localHttpUrl(env.MAIN_APP_PORT || 3000, env.MAIN_APP_BIND_ADDRESS || "127.0.0.1");
}

module.exports = {serviceHost, serviceUrl, validPort, localHttpUrl, mainAppUrl};
