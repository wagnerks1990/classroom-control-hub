"use strict";

const net = require("node:net");
const {serviceHost, validPort} = require("./network");
const CONNECT_TIMEOUT_MS = 10000;
const MAX_PENDING_FRAMES = 100;
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

// API control/authentication and dedicated Sendspin audio are separate transports.
// Only administrator-owned configuration selects this upstream; never a TV payload.
function sendspinEndpoint(config = {}, mode = process.env.HUB_NETWORK_MODE) {
  let fallback = "127.0.0.1";
  if (config.url) fallback = new URL(config.url).hostname;
  let host = String(config.sendspinHost || fallback).trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = serviceHost(host, ["music-assistant", "music-assistant-server"], mode);
  const hostname = host.length <= 253 && host.split(".").every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if (!net.isIP(host) && !hostname) throw Error("Sendspin host must be a hostname or IP address, not a URL");
  const port = validPort(config.sendspinPort, 8927);
  return `ws://${net.isIP(host) === 6 ? `[${host}]` : host}:${port}/sendspin`;
}

function closeCode(code) {
  return (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999) ? code : 1011;
}

function byteLength(data) {
  if (Array.isArray(data)) return data.reduce((n, chunk) => n + byteLength(chunk), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  return Buffer.byteLength(data);
}

// The caller must consume a one-time ticket and check attachment before calling.
// WebSocket is injected so lifecycle races can be tested without a real MA server.
function relaySendspin(client, {WebSocket, config, maxPayload = MAX_BUFFERED_BYTES,
  onConnected = () => {}, onError = () => {}}) {
  let upstream = null, ready = false, closed = false, connectTimer = null;
  let pendingBytes = 0;
  const pending = [];

  function stop(socket, code, reason) {
    if (!socket) return;
    try {
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    } catch { try { socket.terminate(); } catch {} }
  }
  function finish(code = 1011, reason = "Music Assistant Sendspin connection closed") {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer); connectTimer = null;
    pending.length = 0; pendingBytes = 0;
    stop(upstream, 1000, "Hub bridge closed");
    stop(client, closeCode(code), reason);
  }
  function failure(error) {
    if (closed) return;
    // Log only the error, never protocol frames or API credentials.
    try { onError(error); } catch {}
    finish(1011, "Music Assistant Sendspin upstream error");
  }
  function forward(socket, data, isBinary) {
    if (closed || socket?.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount + byteLength(data) > MAX_BUFFERED_BYTES) {
      finish(1013, "Music Assistant Sendspin bridge buffer limit exceeded"); return false;
    }
    try { socket.send(data, {binary: isBinary}, error => { if (error) failure(error); }); }
    catch (error) { failure(error); return false; }
    return !closed;
  }

  client.on("close", () => finish(1000));
  client.on("error", failure);
  client.on("message", (data, isBinary) => {
    if (closed) return;
    if (ready) { forward(upstream, data, isBinary); return; }
    const size = byteLength(data);
    if (pending.length >= MAX_PENDING_FRAMES || pendingBytes + size > MAX_PENDING_BYTES) {
      finish(1009, "Music Assistant Sendspin pending buffer limit exceeded"); return;
    }
    pending.push({data, isBinary}); pendingBytes += size;
  });

  try {
    if (client.readyState !== WebSocket.OPEN) { finish(1000); return {close: finish}; }
    const url = sendspinEndpoint(config);
    upstream = new WebSocket(url, {handshakeTimeout: CONNECT_TIMEOUT_MS, maxPayload, followRedirects: false});
    upstream.binaryType = "arraybuffer";
    upstream.on("error", failure);
    upstream.on("close", code => finish(code, "Music Assistant Sendspin upstream closed"));
    upstream.on("message", (data, isBinary) => forward(client, data, isBinary));
    connectTimer = setTimeout(() => finish(1011, "Music Assistant Sendspin upstream connection timed out"), CONNECT_TIMEOUT_MS);
    upstream.on("open", () => {
      if (closed || client.readyState !== WebSocket.OPEN) { stop(upstream, 1000, "Hub bridge closed"); return; }
      ready = true; clearTimeout(connectTimer); connectTimer = null;
      // No MA API auth preamble and no swallowed first server frame: raw Sendspin.
      for (const frame of pending.splice(0)) if (!forward(upstream, frame.data, frame.isBinary)) break;
      pendingBytes = 0;
      if (!closed) { try { onConnected(url); } catch (error) { failure(error); } }
    });
  } catch (error) { failure(error); }
  return {close: finish};
}

module.exports = {sendspinEndpoint, relaySendspin};
