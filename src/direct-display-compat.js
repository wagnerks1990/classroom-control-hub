"use strict";

// Direct classroom displays are intentionally addressed by stable configured
// IDs (/display/tv1, /display/tv2, ...), without per-browser enrollment.
//
// server.js still uses its historical "legacy" marker for credential-less
// signed asset tokens. Keep that marker valid for protected /media and
// /presentations requests while the direct-display model is active. The token
// itself remains HMAC-signed, expires normally, and is bound to an enabled
// configured display ID.
const { ClassroomHubStorage } = require("./storage");
const { installDisplayGatewayCompatibility } = require("./display-gateway");

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

  // Install direct display authentication before startup-recovery.js runs.
  // Marking this function with __directDisplayAccess makes startup recovery
  // recognize that the direct-display contract is already installed and avoids
  // replacing it with an object carrying a synthetic credential ID such as
  // "direct:tv1". Omitting a credential ID intentionally makes server.js issue
  // the signed asset token with its compatibility marker, which the policy
  // above authorizes without restoring browser enrollment.
  function authenticateConfiguredDisplay(displayId) {
    const id = String(displayId || "").trim();
    if (!id) return null;
    const row = this.db.prepare("SELECT id,enabled FROM display_devices WHERE id=? LIMIT 1").get(id);
    if (!row || Number(row.enabled) === 0) return null;
    return {
      displayId: id,
      label: "Configured display URL",
      direct: true
    };
  }
  authenticateConfiguredDisplay.__directDisplayAccess = true;
  prototype.authenticateDisplay = authenticateConfiguredDisplay;

  Object.defineProperty(prototype, "__directDisplayPolicyCompatInstalled", {
    value: true,
    enumerable: false,
    configurable: false
  });
}

// The preload also installs the Managed Display Gateway before server.js creates
// its Express application. That keeps the large application server unchanged
// while giving physical display browsers a same-origin route for approved
// external sites. DNS overrides are process-local: the Hub itself resolves the
// configured upstream hostname to the forced address while TLS SNI/Host remain
// the original hostname.
installDisplayGatewayCompatibility();
