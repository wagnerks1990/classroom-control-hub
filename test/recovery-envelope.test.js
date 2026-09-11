"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  encryptRecoveryEnvelope,
  decryptRecoveryEnvelope,
  parseRecoveryEnvelopeHeader,
  RecoveryEnvelopeInputError,
  RecoveryEnvelopeAuthenticationError,
  RECOVERY_ENVELOPE_LIMITS,
  RECOVERY_ENVELOPE_KDF
} = require("../maintenance-agent/recovery-envelope");

const PASSPHRASE = "correct horse battery staple";

test("recovery envelope round-trips binary payload and canonical metadata", () => {
  const plaintext = Buffer.from([0, 255, 1, 42, 0, 99]);
  const metadata = {z: "last", nested: {b: 2, a: true}, a: ["first", null]};
  const envelope = encryptRecoveryEnvelope(plaintext, PASSPHRASE, {metadata});
  assert.notDeepEqual(envelope, plaintext);
  const inspected = parseRecoveryEnvelopeHeader(envelope);
  assert.equal(inspected.header.format, "roomgoblin-full-recovery");
  assert.deepEqual(inspected.metadata, metadata);
  const restored = decryptRecoveryEnvelope(envelope, PASSPHRASE);
  assert.deepEqual(restored.plaintext, plaintext);
  assert.deepEqual(restored.metadata, metadata);
});

test("envelope fixes reviewed cryptographic parameters and randomizes each export", () => {
  const payload = Buffer.from("same recovery archive");
  const first = encryptRecoveryEnvelope(payload, PASSPHRASE);
  const second = encryptRecoveryEnvelope(payload, PASSPHRASE);
  assert.notDeepEqual(first, second);
  const firstHeader = parseRecoveryEnvelopeHeader(first).header;
  const secondHeader = parseRecoveryEnvelopeHeader(second).header;
  assert.deepEqual(
    {name: firstHeader.kdf.name, N: firstHeader.kdf.N, r: firstHeader.kdf.r, p: firstHeader.kdf.p},
    {name: "scrypt", N: 32768, r: 8, p: 1}
  );
  assert.equal(firstHeader.cipher, "aes-256-gcm");
  assert.equal(Buffer.from(firstHeader.kdf.salt, "base64").length, RECOVERY_ENVELOPE_KDF.saltBytes);
  assert.equal(Buffer.from(firstHeader.nonce, "base64").length, RECOVERY_ENVELOPE_LIMITS.nonceBytes);
  assert.notEqual(firstHeader.kdf.salt, secondHeader.kdf.salt);
  assert.notEqual(firstHeader.nonce, secondHeader.nonce);
});

test("wrong passphrase and tampering produce one authentication failure", () => {
  const envelope = encryptRecoveryEnvelope(Buffer.from("sensitive recovery state"), PASSPHRASE, {metadata: {release: "test"}});
  const mutations = [
    {label: "wrong passphrase", bytes: envelope, passphrase: "wrong passphrase is long enough"},
    {label: "short wrong passphrase", bytes: envelope, passphrase: "wrong"},
    {label: "header", bytes: mutate(envelope, 20), passphrase: PASSPHRASE},
    {label: "ciphertext", bytes: mutate(envelope, envelope.length - 20), passphrase: PASSPHRASE},
    {label: "tag", bytes: mutate(envelope, envelope.length - 1), passphrase: PASSPHRASE},
    {label: "truncation", bytes: envelope.subarray(0, envelope.length - 1), passphrase: PASSPHRASE}
  ];
  for (const fixture of mutations) {
    assert.throws(
      () => decryptRecoveryEnvelope(fixture.bytes, fixture.passphrase),
      error => error instanceof RecoveryEnvelopeAuthenticationError &&
        error.code === "RECOVERY_ENVELOPE_AUTHENTICATION_FAILED" &&
        error.message === "Recovery envelope authentication failed",
      fixture.label
    );
  }
});

test("passphrase boundaries use characters for minimum and UTF-8 bytes for maximum", () => {
  assert.throws(() => encryptRecoveryEnvelope(Buffer.alloc(0), "123456789012345"), RecoveryEnvelopeInputError);
  assert.doesNotThrow(() => encryptRecoveryEnvelope(Buffer.alloc(0), "1234567890123456"));
  assert.doesNotThrow(() => encryptRecoveryEnvelope(Buffer.alloc(0), "🔐".repeat(16)));
  assert.doesNotThrow(() => encryptRecoveryEnvelope(Buffer.alloc(0), "é".repeat(512)));
  assert.throws(() => encryptRecoveryEnvelope(Buffer.alloc(0), "é".repeat(513)), /1024 UTF-8 bytes/);
});

test("payload and metadata limits fail before encryption", () => {
  assert.throws(
    () => encryptRecoveryEnvelope(Buffer.alloc(9), PASSPHRASE, {maxPayloadBytes: 8}),
    /exceeds the configured 8-byte limit/
  );
  const small = encryptRecoveryEnvelope(Buffer.alloc(8), PASSPHRASE, {maxPayloadBytes: 8});
  assert.throws(() => decryptRecoveryEnvelope(small, PASSPHRASE, {maxPayloadBytes: 7}), RecoveryEnvelopeAuthenticationError);
  assert.throws(
    () => encryptRecoveryEnvelope(Buffer.alloc(0), PASSPHRASE, {metadata: {large: "x".repeat(RECOVERY_ENVELOPE_LIMITS.maxMetadataBytes)}}),
    /metadata exceeds/
  );
  assert.throws(
    () => encryptRecoveryEnvelope(Buffer.alloc(0), PASSPHRASE, {maxPayloadBytes: RECOVERY_ENVELOPE_LIMITS.absoluteMaxPayloadBytes + 1}),
    /payload limit/
  );
});

test("metadata excludes non-JSON and prototype-sensitive values", () => {
  assert.throws(() => encryptRecoveryEnvelope(Buffer.alloc(0), PASSPHRASE, {metadata: {bad: undefined}}), /only JSON values/);
  assert.throws(() => encryptRecoveryEnvelope(Buffer.alloc(0), PASSPHRASE, {metadata: {bad: Array(1)}}), /sparse arrays/);
  assert.throws(() => encryptRecoveryEnvelope(Buffer.alloc(0), PASSPHRASE, {metadata: new Date()}), /plain JSON objects/);
  const unsafe = Object.create(null);
  unsafe.__proto__ = "unsafe";
  assert.throws(() => encryptRecoveryEnvelope(Buffer.alloc(0), PASSPHRASE, {metadata: unsafe}), /unsafe object key/);
});

function mutate(source, offset) {
  const result = Buffer.from(source);
  result[offset] ^= 1;
  return result;
}
