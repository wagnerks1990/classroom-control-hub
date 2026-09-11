"use strict";

const crypto = require("node:crypto");

const MAGIC = Buffer.from("RGBKREC1", "ascii");
const PREFIX_BYTES = MAGIC.length + 4;
const FORMAT = "roomgoblin-full-recovery";
const VERSION = 1;
const AUTHENTICATION_MESSAGE = "Recovery envelope authentication failed";

const RECOVERY_ENVELOPE_KDF = Object.freeze({
  name: "scrypt",
  N: 32768,
  r: 8,
  p: 1,
  keyBytes: 32,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024
});

const RECOVERY_ENVELOPE_LIMITS = Object.freeze({
  minPassphraseCharacters: 16,
  maxPassphraseBytes: 1024,
  maxMetadataBytes: 4096,
  maxHeaderBytes: 8192,
  defaultMaxPayloadBytes: 256 * 1024 * 1024,
  absoluteMaxPayloadBytes: 512 * 1024 * 1024,
  nonceBytes: 12,
  tagBytes: 16
});

class RecoveryEnvelopeInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecoveryEnvelopeInputError";
    this.code = "RECOVERY_ENVELOPE_INPUT_INVALID";
  }
}

class RecoveryEnvelopeAuthenticationError extends Error {
  constructor() {
    super(AUTHENTICATION_MESSAGE);
    this.name = "RecoveryEnvelopeAuthenticationError";
    this.code = "RECOVERY_ENVELOPE_AUTHENTICATION_FAILED";
  }
}

function validatePassphrase(passphrase) {
  if (typeof passphrase !== "string") {
    throw new RecoveryEnvelopeInputError("Recovery passphrase must be a string");
  }
  if (Array.from(passphrase).length < RECOVERY_ENVELOPE_LIMITS.minPassphraseCharacters) {
    throw new RecoveryEnvelopeInputError("Recovery passphrase must contain at least 16 characters");
  }
  if (Buffer.byteLength(passphrase, "utf8") > RECOVERY_ENVELOPE_LIMITS.maxPassphraseBytes) {
    throw new RecoveryEnvelopeInputError("Recovery passphrase must not exceed 1024 UTF-8 bytes");
  }
  return passphrase;
}

function payloadLimit(value) {
  const limit = value == null ? RECOVERY_ENVELOPE_LIMITS.defaultMaxPayloadBytes : value;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RECOVERY_ENVELOPE_LIMITS.absoluteMaxPayloadBytes) {
    throw new RecoveryEnvelopeInputError(
      `Recovery payload limit must be an integer from 1 to ${RECOVERY_ENVELOPE_LIMITS.absoluteMaxPayloadBytes} bytes`
    );
  }
  return limit;
}

function asPayload(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new RecoveryEnvelopeInputError("Recovery payload must be a Buffer or Uint8Array");
  }
  return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function canonicalize(value, depth = 0) {
  if (depth > 12) throw new RecoveryEnvelopeInputError("Recovery metadata is nested too deeply");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RecoveryEnvelopeInputError("Recovery metadata contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) {
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new RecoveryEnvelopeInputError("Recovery metadata must not contain sparse arrays");
      result.push(canonicalize(value[index], depth + 1));
    }
    return result;
  }
  if (typeof value !== "object") throw new RecoveryEnvelopeInputError("Recovery metadata must contain only JSON values");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RecoveryEnvelopeInputError("Recovery metadata must contain only plain JSON objects");
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new RecoveryEnvelopeInputError("Recovery metadata contains an unsafe object key");
    }
    result[key] = canonicalize(value[key], depth + 1);
  }
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalMetadata(metadata) {
  const clean = canonicalize(metadata == null ? {} : metadata);
  if (clean === null || Array.isArray(clean) || typeof clean !== "object") {
    throw new RecoveryEnvelopeInputError("Recovery metadata must be a JSON object");
  }
  const encoded = Buffer.from(JSON.stringify(clean), "utf8");
  if (encoded.length > RECOVERY_ENVELOPE_LIMITS.maxMetadataBytes) {
    throw new RecoveryEnvelopeInputError("Recovery metadata exceeds the 4096-byte limit");
  }
  return clean;
}

function encodeBase64(value) {
  return value.toString("base64");
}

function decodeFixedBase64(value, bytes) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error("invalid base64");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== bytes || encodeBase64(decoded) !== value) throw Error("invalid base64");
  return decoded;
}

function exactKeys(object, expected) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  const actual = Object.keys(object).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function buildHeader(payloadBytes, metadata, salt, nonce) {
  return {
    cipher: "aes-256-gcm",
    ciphertextBytes: payloadBytes,
    format: FORMAT,
    kdf: {
      N: RECOVERY_ENVELOPE_KDF.N,
      name: RECOVERY_ENVELOPE_KDF.name,
      p: RECOVERY_ENVELOPE_KDF.p,
      r: RECOVERY_ENVELOPE_KDF.r,
      salt: encodeBase64(salt)
    },
    metadata,
    nonce: encodeBase64(nonce),
    tagBytes: RECOVERY_ENVELOPE_LIMITS.tagBytes,
    version: VERSION
  };
}

function encodePrefix(headerBytes) {
  const prefix = Buffer.allocUnsafe(PREFIX_BYTES);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(headerBytes, MAGIC.length);
  return prefix;
}

function parseHeaderInternal(envelope, maxPayloadBytes) {
  if (envelope.length < PREFIX_BYTES + 2 + RECOVERY_ENVELOPE_LIMITS.tagBytes) throw Error("truncated");
  if (!crypto.timingSafeEqual(envelope.subarray(0, MAGIC.length), MAGIC)) throw Error("magic");
  const headerBytes = envelope.readUInt32BE(MAGIC.length);
  if (headerBytes < 2 || headerBytes > RECOVERY_ENVELOPE_LIMITS.maxHeaderBytes) throw Error("header size");
  const headerEnd = PREFIX_BYTES + headerBytes;
  if (headerEnd + RECOVERY_ENVELOPE_LIMITS.tagBytes > envelope.length) throw Error("truncated");
  const rawHeader = envelope.subarray(PREFIX_BYTES, headerEnd);
  let header;
  try { header = JSON.parse(rawHeader.toString("utf8")); } catch { throw Error("header json"); }
  if (!exactKeys(header, ["cipher", "ciphertextBytes", "format", "kdf", "metadata", "nonce", "tagBytes", "version"])) throw Error("header fields");
  if (!exactKeys(header.kdf, ["N", "name", "p", "r", "salt"])) throw Error("kdf fields");
  if (header.format !== FORMAT || header.version !== VERSION || header.cipher !== "aes-256-gcm") throw Error("format");
  if (header.tagBytes !== RECOVERY_ENVELOPE_LIMITS.tagBytes) throw Error("tag size");
  if (header.kdf.name !== RECOVERY_ENVELOPE_KDF.name || header.kdf.N !== RECOVERY_ENVELOPE_KDF.N ||
      header.kdf.r !== RECOVERY_ENVELOPE_KDF.r || header.kdf.p !== RECOVERY_ENVELOPE_KDF.p) throw Error("kdf parameters");
  if (!Number.isSafeInteger(header.ciphertextBytes) || header.ciphertextBytes < 0 || header.ciphertextBytes > maxPayloadBytes) throw Error("payload size");
  const expectedBytes = headerEnd + header.ciphertextBytes + RECOVERY_ENVELOPE_LIMITS.tagBytes;
  if (envelope.length !== expectedBytes) throw Error("envelope size");
  const metadata = canonicalMetadata(header.metadata);
  const canonical = Buffer.from(canonicalJson({...header, metadata}), "utf8");
  if (canonical.length !== rawHeader.length || !crypto.timingSafeEqual(canonical, rawHeader)) throw Error("non-canonical header");
  return {
    header,
    metadata,
    salt: decodeFixedBase64(header.kdf.salt, RECOVERY_ENVELOPE_KDF.saltBytes),
    nonce: decodeFixedBase64(header.nonce, RECOVERY_ENVELOPE_LIMITS.nonceBytes),
    aad: envelope.subarray(0, headerEnd),
    ciphertext: envelope.subarray(headerEnd, headerEnd + header.ciphertextBytes),
    tag: envelope.subarray(envelope.length - RECOVERY_ENVELOPE_LIMITS.tagBytes)
  };
}

function parseRecoveryEnvelopeHeader(envelope, options = {}) {
  const bytes = asPayload(envelope);
  const maxPayloadBytes = payloadLimit(options.maxPayloadBytes);
  try {
    const parsed = parseHeaderInternal(bytes, maxPayloadBytes);
    return {header: parsed.header, metadata: parsed.metadata};
  } catch (error) {
    if (error instanceof RecoveryEnvelopeInputError) throw error;
    throw new RecoveryEnvelopeAuthenticationError();
  }
}

function encryptRecoveryEnvelope(plaintext, passphrase, options = {}) {
  const bytes = asPayload(plaintext);
  const maxPayloadBytes = payloadLimit(options.maxPayloadBytes);
  validatePassphrase(passphrase);
  if (bytes.length > maxPayloadBytes) {
    throw new RecoveryEnvelopeInputError(`Recovery payload exceeds the configured ${maxPayloadBytes}-byte limit`);
  }
  const metadata = canonicalMetadata(options.metadata);
  const salt = crypto.randomBytes(RECOVERY_ENVELOPE_KDF.saltBytes);
  const nonce = crypto.randomBytes(RECOVERY_ENVELOPE_LIMITS.nonceBytes);
  const header = buildHeader(bytes.length, metadata, salt, nonce);
  const rawHeader = Buffer.from(canonicalJson(header), "utf8");
  if (rawHeader.length > RECOVERY_ENVELOPE_LIMITS.maxHeaderBytes) {
    throw new RecoveryEnvelopeInputError("Recovery envelope header exceeds its limit");
  }
  const prefix = encodePrefix(rawHeader.length);
  const aad = Buffer.concat([prefix, rawHeader]);
  const key = crypto.scryptSync(passphrase, salt, RECOVERY_ENVELOPE_KDF.keyBytes, RECOVERY_ENVELOPE_KDF);
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce, {authTagLength: RECOVERY_ENVELOPE_LIMITS.tagBytes});
    cipher.setAAD(aad, {plaintextLength: bytes.length});
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([aad, ciphertext, cipher.getAuthTag()]);
  } finally {
    key.fill(0);
  }
}

function decryptRecoveryEnvelope(envelope, passphrase, options = {}) {
  const bytes = asPayload(envelope);
  const maxPayloadBytes = payloadLimit(options.maxPayloadBytes);
  try { validatePassphrase(passphrase); } catch {
    throw new RecoveryEnvelopeAuthenticationError();
  }
  let parsed;
  try { parsed = parseHeaderInternal(bytes, maxPayloadBytes); } catch {
    throw new RecoveryEnvelopeAuthenticationError();
  }
  let key;
  try {
    key = crypto.scryptSync(passphrase, parsed.salt, RECOVERY_ENVELOPE_KDF.keyBytes, RECOVERY_ENVELOPE_KDF);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, parsed.nonce, {authTagLength: RECOVERY_ENVELOPE_LIMITS.tagBytes});
    decipher.setAAD(parsed.aad, {plaintextLength: parsed.ciphertext.length});
    decipher.setAuthTag(parsed.tag);
    const plaintext = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
    return {plaintext, metadata: parsed.metadata};
  } catch {
    throw new RecoveryEnvelopeAuthenticationError();
  } finally {
    if (key) key.fill(0);
  }
}

module.exports = {
  encryptRecoveryEnvelope,
  decryptRecoveryEnvelope,
  parseRecoveryEnvelopeHeader,
  validatePassphrase,
  RecoveryEnvelopeInputError,
  RecoveryEnvelopeAuthenticationError,
  RECOVERY_ENVELOPE_LIMITS,
  RECOVERY_ENVELOPE_KDF
};
