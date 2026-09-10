// Receiver input boundaries. Keep URL policy separate from logical layout.
export const IDENTIFY_DEFAULT_MS = 8000;
export const IDENTIFY_MAX_MS = 30000;

const DISPLAY_GATEWAY_HOSTS = new Set(['stream.carlisleschools.org']);

export function identifyDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || value === undefined || value === null || value === '') return IDENTIFY_DEFAULT_MS;
  return Math.max(1000, Math.min(IDENTIFY_MAX_MS, Math.trunc(number)));
}

function displayGatewayUrl(url, origin) {
  return `${origin}/display-gateway/${url.protocol.slice(0, -1)}/${encodeURIComponent(url.host)}${url.pathname}${url.search}${url.hash}`;
}

// External HTTP(S) content is an intentional operator-controlled signage feature.
// Executable/opaque schemes, embedded credentials and malformed URLs are not.
// Use the origin as the base, never query/hash-controlled parts of location.href.
export function authorizeMediaUrl(value, baseOrigin, accessToken = '', depth = 0) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || depth > 4 || /[\u0000-\u001f\u007f\\]/.test(value)) {
    throw new Error('Invalid display media URL');
  }
  const origin = new URL(baseOrigin).origin;
  const url = new URL(value.trim(), `${origin}/`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Display media must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('Display media URLs cannot include credentials');
  if (url.origin === origin) {
    if (url.pathname === '/document-viewer/') {
      const file = url.searchParams.get('file');
      if (file) url.searchParams.set('file', authorizeMediaUrl(file, origin, accessToken, depth + 1));
    }
    if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/presentations/')) {
      url.searchParams.set('access_token', accessToken);
    }
    return url.href;
  }
  // Managed-display domain routes stay same-origin with Classroom Control Hub.
  // The backend gateway preserves the original Host/TLS SNI while applying its
  // configured DNS/IP override, so TVs do not need hosts-file changes.
  if (DISPLAY_GATEWAY_HOSTS.has(url.hostname.toLowerCase())) return displayGatewayUrl(url, origin);
  return url.href;
}

// Only the Hub's ticketed proxy is a permitted audio WebSocket destination.
// The caller cannot supply another host, port, protocol, path or query key.
export function musicAssistantProxyUrl(value, baseOrigin) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) {
    throw new Error('Invalid Music Assistant proxy URL');
  }
  const hub = new URL(baseOrigin);
  if (hub.protocol !== 'http:' && hub.protocol !== 'https:') throw new Error('Invalid Hub origin');
  const scheme = hub.protocol === 'https:' ? 'wss:' : 'ws:';
  const socketOrigin = `${scheme}//${hub.host}`;
  const candidate = new URL(value, `${socketOrigin}/`);
  if (candidate.origin !== socketOrigin || candidate.pathname !== '/music-assistant/sendspin-proxy' || candidate.username || candidate.password || candidate.hash) {
    throw new Error('Music Assistant must use this Hub\'s Sendspin proxy');
  }
  const entries = [...candidate.searchParams.entries()];
  const ticket = candidate.searchParams.get('ticket') || '';
  if (entries.length !== 1 || entries[0][0] !== 'ticket' || !/^[A-Za-z0-9_-]{32}$/.test(ticket)) {
    throw new Error('Invalid Music Assistant proxy ticket');
  }
  return `${socketOrigin}/music-assistant/sendspin-proxy?ticket=${encodeURIComponent(ticket)}`;
}
