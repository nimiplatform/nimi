import { readFileSync } from 'node:fs';

function origin(value, name) {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error(`${name} must be an exact HTTP(S) origin.`);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`${name} requires HTTPS outside loopback.`);
  return url;
}

export function labCoordinationPath(url) {
  const path = url.split('?')[0];
  return /^\/api\/runtime-access\/(?:token|context(?:\/end)?|connections(?:\/[A-Za-z0-9_-]+)?)$/.test(path)
    || /^\/api\/auth\/runtime-clients\/[A-Za-z0-9_.-]+$/.test(path);
}

export function labWebOriginGuard(expected) {
  return (request, response, next) => {
    const h1 = request.headers.host;
    const host = request.headers[':authority'] ?? h1;
    if (typeof host !== 'string' || host.toLowerCase() !== expected.host
      || (h1 !== undefined && (typeof h1 !== 'string' || h1.toLowerCase() !== expected.host))) {
      response.writeHead(421, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Use the configured Lab Web origin.'); return;
    }
    if (request.url?.startsWith('/api/') && !labCoordinationPath(request.url)) {
      response.writeHead(404); response.end(); return;
    }
    next();
  };
}

export function labWebDevelopment(env, read = readFileSync) {
  const site = origin(env.NIMI_LAB_WEB_ORIGIN || 'https://127.0.0.1:4468', 'NIMI_LAB_WEB_ORIGIN');
  if (site.protocol !== 'https:') throw new Error('Lab Web Runtime access requires HTTPS.');
  const realm = origin(env.NIMI_REALM_URL || 'http://127.0.0.1:3002', 'NIMI_REALM_URL');
  if (env.VITE_NIMI_OFFICIAL_WEB_URL) {
    const official = origin(env.VITE_NIMI_OFFICIAL_WEB_URL, 'VITE_NIMI_OFFICIAL_WEB_URL');
    if (official.hostname === site.hostname) throw new Error('Lab and official sign-in require different hostnames. Ports do not isolate cookies.');
  }
  if (!env.NIMI_LAB_WEB_TLS_KEY || !env.NIMI_LAB_WEB_TLS_CERT) throw new Error('Set NIMI_LAB_WEB_TLS_KEY and NIMI_LAB_WEB_TLS_CERT to browser-trusted certificate files.');
  return {
    origin: site,
    server: {
      host: env.NIMI_LAB_WEB_BIND_HOST || '127.0.0.1', port: Number(site.port || 443), strictPort: true,
      https: { key: read(env.NIMI_LAB_WEB_TLS_KEY), cert: read(env.NIMI_LAB_WEB_TLS_CERT) },
      proxy: {
        '^/api/(runtime-access/|auth/runtime-clients/)': {
          target: realm.origin, changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', request => request.removeHeader('cookie'));
            proxy.on('proxyRes', response => { delete response.headers['set-cookie']; });
          },
        },
      },
    },
    plugin: { name: 'lab-web-origin', enforce: 'pre', configureServer(server) { server.middlewares.use(labWebOriginGuard(site)); } },
  };
}
