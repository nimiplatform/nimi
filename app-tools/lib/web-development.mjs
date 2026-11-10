// @nimi-authority: rule.nimi.platform.app-ecosystem.scaffold-web-carrier
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

function exactOrigin(value, label, requireHttps = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an exact origin.`); }
  if (url.origin !== value || url.username || url.password
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && !requireHttps && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error(`${label} requires HTTPS (HTTP is allowed only for loopback coordination).`);
  }
  return url;
}

export function readWebDevelopment(manifest) {
  const web = manifest?.local_development?.web;
  if (!web || typeof web !== 'object' || Array.isArray(web)) throw new Error('Declare local_development.web in nimi.app.yaml.');
  const site = exactOrigin(web.origin, 'Web origin', true);
  const realm = exactOrigin(web.realm_url, 'Realm URL');
  const official = exactOrigin(web.official_web_url, 'Official Web URL');
  if (site.hostname === official.hostname) throw new Error('Use different hostnames for the App and official sign-in; ports do not isolate cookies.');
  const callback = new URL(web.redirect_uri);
  if (callback.origin !== site.origin || callback.username || callback.password || callback.search || callback.hash || callback.href !== web.redirect_uri) {
    throw new Error('Web callback must be an exact URL on the configured HTTPS App origin.');
  }
  for (const [label, value] of [['app_id', manifest.app_id], ['client_id', web.client_id], ['realm_environment_id', web.realm_environment_id]]) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value)) throw new Error(`Invalid Web ${label}.`);
  }
  const match = typeof web.command === 'string' && /^pnpm run ([A-Za-z0-9][A-Za-z0-9:_.-]*)$/u.exec(web.command);
  if (!match) throw new Error('Web command must name an App-owned pnpm script.');
  return Object.freeze({ site, realm, official, command: web.command, script: match[1], config: Object.freeze({
    appId: manifest.app_id, clientId: web.client_id, realmEnvironmentId: web.realm_environment_id,
    officialWebBaseUrl: official.origin, realmBaseUrl: site.origin, redirectUri: callback.href,
  }) });
}

export function isWebCoordinationPath(method, url) {
  const pathname = url.split('?')[0];
  if (method === 'GET') {
    return pathname === '/api/runtime-access/context'
      || /^\/api\/runtime-access\/connections\/[A-Za-z0-9_-]+$/u.test(pathname)
      || /^\/api\/auth\/runtime-clients\/[A-Za-z0-9_.-]+$/u.test(pathname);
  }
  return method === 'POST' && (pathname === '/api/runtime-access/token'
    || pathname === '/api/runtime-access/context/end'
    || pathname === '/api/runtime-access/connections');
}

export function webOriginGuard(site) {
  return (request, response, next) => {
    const h1 = request.headers.host;
    const host = request.headers[':authority'] ?? h1;
    if (typeof host !== 'string' || host.toLowerCase() !== site.host
      || (h1 !== undefined && (typeof h1 !== 'string' || h1.toLowerCase() !== site.host))) {
      response.writeHead(421, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Use the configured App origin.'); return;
    }
    if (request.url?.startsWith('/api/') && !isWebCoordinationPath(request.method, request.url)) {
      response.writeHead(404); response.end(); return;
    }
    next();
  };
}

/** Vite configuration for a declared development source. No credentials or
 * admission decision are generated. Production hosting must supply the same
 * bounded coordination routes independently of this development server. */
export function nimiWebViteConfig({ root, env = process.env, serve = true }) {
  const manifest = parseYaml(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8'));
  const { site, realm, config } = readWebDevelopment(manifest);
  const define = { __NIMI_APP_WEB_CONFIG__: JSON.stringify(config) };
  if (!serve) return { define };
  if (!env.NIMI_WEB_TLS_KEY || !env.NIMI_WEB_TLS_CERT) throw new Error('Set NIMI_WEB_TLS_KEY and NIMI_WEB_TLS_CERT to browser-trusted certificate files.');
  return {
    define,
    server: {
      host: env.NIMI_WEB_BIND_HOST || '127.0.0.1', port: Number(site.port || 443), strictPort: true,
      https: { key: readFileSync(path.resolve(root, env.NIMI_WEB_TLS_KEY)), cert: readFileSync(path.resolve(root, env.NIMI_WEB_TLS_CERT)) },
      proxy: { '^/api/(runtime-access/|auth/runtime-clients/)': {
        target: realm.origin, changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', request => request.removeHeader('cookie'));
          proxy.on('proxyRes', response => { delete response.headers['set-cookie']; });
        },
      } },
    },
    plugins: [{ name: 'nimi-web-origin', enforce: 'pre', configureServer(server) { server.middlewares.use(webOriginGuard(site)); } }],
  };
}
