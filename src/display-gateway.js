"use strict";

const dns = require("dns");
const http = require("http");
const https = require("https");

const DEFAULT_OVERRIDE = "stream.carlisleschools.org=100.88.92.111";
const GATEWAY_PREFIX = "/display-gateway";
const MAX_REWRITE_BYTES = 8 * 1024 * 1024;

function parseOverrides(raw = process.env.DISPLAY_GATEWAY_OVERRIDES || DEFAULT_OVERRIDE) {
  const overrides = new Map();
  for (const entry of String(raw || "").split(",")) {
    const text = entry.trim();
    if (!text) continue;
    const i = text.lastIndexOf("=");
    if (i <= 0) continue;
    const host = text.slice(0, i).trim().toLowerCase();
    const address = text.slice(i + 1).trim();
    if (!/^[a-z0-9.-]+$/i.test(host)) continue;
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) continue;
    const octets = address.split(".").map(Number);
    if (octets.some((value) => value < 0 || value > 255)) continue;
    overrides.set(host, address);
  }
  return overrides;
}

function parseAllowedHosts(raw = process.env.DISPLAY_GATEWAY_ALLOWED_HOSTS || "", overrides = parseOverrides()) {
  const hosts = new Set([...overrides.keys()]);
  for (const host of String(raw || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)) {
    if (/^[a-z0-9.-]+$/i.test(host)) hosts.add(host);
  }
  return hosts;
}

function gatewayPathFor(target, baseOrigin = "http://classroom-hub.local") {
  const url = target instanceof URL ? target : new URL(String(target));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Display gateway target must be an HTTP(S) URL without credentials");
  const origin = new URL(baseOrigin).origin;
  return `${origin}${GATEWAY_PREFIX}/${url.protocol.slice(0, -1)}/${encodeURIComponent(url.host)}${url.pathname}${url.search}${url.hash}`;
}

function parseGatewayRequest(reqUrl, allowedHosts = parseAllowedHosts()) {
  const url = new URL(String(reqUrl || "/"), "http://classroom-hub.local");
  const match = url.pathname.match(/^\/display-gateway\/(https?)\/([^/]+)(\/.*)?$/i);
  if (!match) return null;
  const protocol = `${match[1].toLowerCase()}:`;
  let host;
  try { host = decodeURIComponent(match[2]); } catch { throw new Error("Invalid display gateway host"); }
  if (host.includes("@") || host.includes("/") || host.includes("\\")) throw new Error("Invalid display gateway host");
  const target = new URL(`${protocol}//${host}${match[3] || "/"}${url.search}`);
  const hostname = target.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) throw new Error(`Display gateway host is not allowed: ${hostname}`);
  return target;
}

function installDnsOverrides(overrides = parseOverrides()) {
  if (dns.lookup.__classroomHubDisplayGateway) return;
  const originalLookup = dns.lookup.bind(dns);
  function lookup(hostname, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    const host = String(hostname || "").toLowerCase();
    const forced = overrides.get(host);
    if (!forced) return originalLookup(hostname, options, callback);
    const opts = typeof options === "number" ? { family: options } : (options || {});
    if (opts.all) return process.nextTick(callback, null, [{ address: forced, family: 4 }]);
    return process.nextTick(callback, null, forced, 4);
  }
  lookup.__classroomHubDisplayGateway = true;
  lookup.__originalLookup = originalLookup;
  dns.lookup = lookup;
}

function isRewriteable(contentType = "") {
  const type = String(contentType).toLowerCase();
  return type.includes("text/html") || type.includes("text/css") || type.includes("javascript") || type.includes("mpegurl") || type.includes("application/json") || type.startsWith("text/");
}

function rewriteLocation(value, target, baseOrigin) {
  if (!value) return value;
  try {
    const resolved = new URL(value, target);
    return gatewayPathFor(resolved, baseOrigin);
  } catch { return value; }
}

function rewriteBody(text, target, baseOrigin) {
  const prefix = `${new URL(baseOrigin).origin}${GATEWAY_PREFIX}/${target.protocol.slice(0, -1)}/${encodeURIComponent(target.host)}`;
  const absoluteOrigin = `${target.protocol}//${target.host}`;
  let out = String(text);
  out = out.split(absoluteOrigin).join(prefix);
  // Preserve root-relative resources inside the proxied domain. This intentionally
  // targets URL-bearing syntax rather than every slash in JavaScript/text.
  out = out.replace(/\b(src|href|action|poster)=(['"])\/(?!\/)/gi, `$1=$2${prefix}/`);
  out = out.replace(/url\((['"]?)\/(?!\/)/gi, `url($1${prefix}/`);
  if (/mpegurl/i.test(String(arguments[3] || "")) || out.startsWith("#EXTM3U")) {
    out = out.split("\n").map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      try { return gatewayPathFor(new URL(trimmed, target), baseOrigin); } catch { return line; }
    }).join("\n");
  }
  return out;
}

function copyResponseHeaders(upstream, res, target, baseOrigin) {
  const blocked = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "content-security-policy", "content-security-policy-report-only"]);
  for (const [name, value] of Object.entries(upstream.headers || {})) {
    if (value === undefined || blocked.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === "location") res.setHeader(name, rewriteLocation(value, target, baseOrigin));
    else res.setHeader(name, value);
  }
  res.setHeader("X-Classroom-Hub-Display-Gateway", "1");
}

function displayGatewayMiddleware({ allowedHosts = parseAllowedHosts() } = {}) {
  return function managedDisplayGateway(req, res, next) {
    let target;
    try { target = parseGatewayRequest(req.originalUrl || req.url, allowedHosts); }
    catch (error) { return res.status(403).json({ ok: false, error: error.message }); }
    if (!target) return next();
    if (req.method === "CONNECT") return res.status(405).json({ ok: false, error: "CONNECT is not supported" });

    const transport = target.protocol === "https:" ? https : http;
    const headers = { ...req.headers, host: target.host };
    for (const name of ["connection", "proxy-connection", "upgrade", "content-length", "accept-encoding"]) delete headers[name];
    headers["accept-encoding"] = "identity";

    const options = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
      servername: target.hostname,
      timeout: 15000
    };

    const upstream = transport.request(options, (up) => {
      const baseOrigin = `${req.protocol || "http"}://${req.get("host")}`;
      res.status(up.statusCode || 502);
      copyResponseHeaders(up, res, target, baseOrigin);
      const contentType = String(up.headers["content-type"] || "");
      if (!isRewriteable(contentType)) return up.pipe(res);

      const chunks = [];
      let total = 0;
      up.on("data", (chunk) => {
        total += chunk.length;
        if (total <= MAX_REWRITE_BYTES) chunks.push(chunk);
      });
      up.on("end", () => {
        if (total > MAX_REWRITE_BYTES) return res.status(502).end("Display gateway response too large to rewrite safely");
        const rewritten = rewriteBody(Buffer.concat(chunks).toString("utf8"), target, baseOrigin, contentType);
        res.send(rewritten);
      });
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Display gateway upstream timed out")));
    upstream.on("error", (error) => {
      if (!res.headersSent) res.status(502).json({ ok: false, error: `Display gateway upstream unavailable: ${error.message}` });
      else res.end();
    });
    req.pipe(upstream);
  };
}

function installDisplayGatewayCompatibility() {
  const overrides = parseOverrides();
  const allowedHosts = parseAllowedHosts(process.env.DISPLAY_GATEWAY_ALLOWED_HOSTS || "", overrides);
  if (!allowedHosts.size) return { overrides, allowedHosts };
  installDnsOverrides(overrides);

  const expressPath = require.resolve("express");
  const originalExpress = require(expressPath);
  if (!originalExpress.__classroomHubDisplayGatewayWrapped) {
    function wrappedExpress(...args) {
      const app = originalExpress(...args);
      app.use(displayGatewayMiddleware({ allowedHosts }));
      return app;
    }
    Object.assign(wrappedExpress, originalExpress);
    Object.setPrototypeOf(wrappedExpress, originalExpress);
    Object.defineProperty(wrappedExpress, "__classroomHubDisplayGatewayWrapped", { value: true });
    require.cache[expressPath].exports = wrappedExpress;
  }
  return { overrides, allowedHosts };
}

module.exports = {
  GATEWAY_PREFIX,
  parseOverrides,
  parseAllowedHosts,
  gatewayPathFor,
  parseGatewayRequest,
  installDnsOverrides,
  displayGatewayMiddleware,
  installDisplayGatewayCompatibility
};
