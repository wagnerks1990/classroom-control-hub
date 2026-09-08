"use strict";

// Direct classroom displays are intentionally addressed by stable configured
// IDs (/display/tv1, /display/tv2, ...), without per-browser enrollment.
// server.js still labels credential-less signed asset tokens with its legacy
// compatibility marker. Keep that marker valid for protected /media and
// /presentations fetches while the direct-display model is active.
//
// This does not weaken the HMAC, expiry, or enabled-display checks performed by
// validAssetAccessToken(); it only removes the retired enrollment-policy gate.
const { ClassroomHubStorage } = require("./storage");

const prototype = ClassroomHubStorage.prototype;
if (!prototype.__directDisplayPolicyCompatInstalled) {
  const originalDisplayCredentialPolicy = prototype.displayCredentialPolicy;
  prototype.displayCredentialPolicy = function directDisplayCredentialPolicy() {
    const policy = originalDisplayCredentialPolicy.call(this);
    return {
      ...policy,
      legacySharedTokenAllowed: true,
      directDisplayAccess: true
    };
  };
  Object.defineProperty(prototype, "__directDisplayPolicyCompatInstalled", {
    value: true,
    enumerable: false,
    configurable: false
  });
}
