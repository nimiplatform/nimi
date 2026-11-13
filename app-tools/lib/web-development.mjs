// @nimi-authority: rule.nimi.platform.app-ecosystem.scaffold-web-carrier
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isWebCoordinationPath as isCoordinationPath } from './web-coordination.mjs';
import { resolveDevelopmentRealm } from './development-environment.mjs';

function exactOrigin(value, label, requireHttps = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an exact origin.`); }
  if (url.origin !== value || url.username || url.password
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && !requireHttps && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error(`${label} requires HTTPS (HTTP is allowed only for loopback coordination).`);
  }
  return url;
}

function readWebSource(appId, web, release = false) {
  const site = exactOrigin(web.origin, 'Web origin', true);
  const official = exactOrigin(web.official_web_url, 'Official Web URL', release);
  if (release && [site, official].some(url => /^(?:localhost|.+\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/u.test(url.hostname))) {
    throw new Error('Web release requires deployed HTTPS origins.');
  }
  if (site.hostname === official.hostname) throw new Error('Use different hostnames for the App and official sign-in; ports do not isolate cookies.');
  const callback = new URL(web.redirect_uri);
  if (callback.origin !== site.origin || callback.username || callback.password || callback.search || callback.hash || callback.href !== web.redirect_uri) {
    throw new Error('Web callback must be an exact URL on the configured HTTPS App origin.');
  }
  for (const [label, value] of [['app_id', appId], ['client_id', web.client_id], ['realm_environment_id', web.realm_environment_id]]) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value)) throw new Error(`Invalid Web ${label}.`);
  }
  return { site, official, config: Object.freeze({
    appId, clientId: web.client_id, realmEnvironmentId: web.realm_environment_id,
    officialWebBaseUrl: official.origin, realmBaseUrl: site.origin, redirectUri: callback.href,
  }) };
}

export function readWebDevelopment(manifest, options = {}) {
  const declaration = manifest?.local_development?.web;
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) throw new Error('Declare local_development.web in nimi.app.yaml.');
  const selected = resolveDevelopmentRealm(options.realm, options.env);
  const sourceInput = selected.name === 'official' ? declaration : declaration.local;
  if (!sourceInput || typeof sourceInput !== 'object' || Array.isArray(sourceInput)) throw new Error('Declare local_development.web.local for local Realm development.');
  const web = { realm_url: selected.apiOrigin, official_web_url: selected.webOrigin, realm_environment_id: selected.environmentId, ...sourceInput, command: declaration.command };
  if (!web.origin || !web.redirect_uri || !web.client_id) throw new Error(`Configure the exact registered ${selected.name} Web origin, redirect_uri and client_id in nimi.app.yaml; a scaffold is not source admission.`);
  if (selected.name === 'official' && (web.realm_url !== selected.apiOrigin || web.official_web_url !== selected.webOrigin || web.realm_environment_id !== selected.environmentId)) {
    throw new Error('Official Web development must use official Realm configuration; select --realm local for local inputs.');
  }
  const source = readWebSource(manifest.app_id, web);
  const realm = exactOrigin(web.realm_url, 'Realm URL');
  const match = typeof web.command === 'string' && /^pnpm run ([A-Za-z0-9][A-Za-z0-9:_.-]*)$/u.exec(web.command);
  if (!match) throw new Error('Web command must name an App-owned pnpm script.');
  return Object.freeze({ ...source, realm, command: web.command, script: match[1] });
}

export function isWebCoordinationPath(method, url) {
  return isCoordinationPath(method, url.split('?')[0]);
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

/** Vite configuration for a declared source. Release hosting owns the same
 * bounded coordination routes independently of the development server. */
export function nimiWebViteConfig({ root, env = process.env, serve = true, release = false }) {
  const manifest = parseYaml(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8'));
  if (release) {
    if (serve) throw new Error('Web release configuration requires a build.');
    const required = key => {
      const value = env[key];
      if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error(`Set ${key} for the Web release.`);
      return value;
    };
    const { config } = readWebSource(manifest.app_id, {
      origin: required('NIMI_WEB_ORIGIN'),
      redirect_uri: required('NIMI_WEB_REDIRECT_URI'),
      client_id: required('NIMI_WEB_CLIENT_ID'),
      realm_environment_id: required('NIMI_WEB_REALM_ENVIRONMENT_ID'),
      official_web_url: required('NIMI_WEB_OFFICIAL_WEB_URL'),
    }, true);
    return { define: { __NIMI_APP_WEB_CONFIG__: JSON.stringify(config) } };
  }
  const { site, realm, config } = readWebDevelopment(manifest, { env });
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
