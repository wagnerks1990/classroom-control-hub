"use strict";

const { installDisplayGatewayCompatibility } = require("./display-gateway");

// This preload installs the Managed Display Gateway before server.js creates
// its Express application. That keeps the large application server unchanged
// while giving physical display browsers a same-origin route for approved
// external sites. DNS overrides are process-local: the Hub itself resolves the
// configured upstream hostname to the forced address while TLS SNI/Host remain
// the original hostname.
installDisplayGatewayCompatibility();
