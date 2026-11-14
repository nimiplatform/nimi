const PORTAL_ORIGIN = 'https://nimi.ai';

function isAccountPath(pathname) {
  return /^\/(?:login|register)(?:\/|$)/u.test(pathname)
    || pathname === '/account' || pathname.startsWith('/account/');
}

// Static hosting only. Realm owns sessions; Runtime owns management and AI.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const accountPath = isAccountPath(url.pathname);
    const productionHost = ['nimi.ai', 'www.nimi.ai', 'web.nimi.ai', 'nimi.xyz', 'www.nimi.xyz'].includes(url.hostname);
    if (productionHost) {
      if (url.origin !== PORTAL_ORIGIN) {
        return new Response(null, {
          status: 308,
          headers: {
            Location: `${PORTAL_ORIGIN}${url.pathname}${url.search}`,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
        });
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
      });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    // Retired page URLs must return Gone before Pages falls back to index.html.
    if (/^\/blueyard(?:\.html)?\/?$/u.test(url.pathname)) {
      return new Response(request.method === 'HEAD' ? null : 'Gone', { status: 410 });
    }

    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    // The native authorization form must send its real Origin to Realm. With
    // no-referrer, browsers send Origin: null for navigation-mode POSTs.
    // Keep callback documents private and never include a path or query here.
    const runtimeConnectDocument = url.origin === PORTAL_ORIGIN
      && (url.pathname === '/account/connect' || url.pathname === '/account/connect/');
    response.headers.set('Referrer-Policy', runtimeConnectDocument ? 'strict-origin' : 'no-referrer');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    response.headers.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
    if (accountPath) response.headers.set('Cache-Control', 'no-store');
    if (!productionHost) {
      response.headers.set('X-Robots-Tag', 'noindex');
      // Preview HTML can be inspected, but cannot call production Realm or initiate forms there.
      response.headers.append('Content-Security-Policy', "connect-src 'self'; form-action 'self'");
    }
    return response;
  },
};
