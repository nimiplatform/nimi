import { handleNimiWebCoordination, isWebCoordinationPath } from '../../app-tools/lib/web-coordination.mjs';

const policyGrace = 24 * 60 * 60 * 1000;
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
const error = (status, reason) => json({ error: reason }, status);
const types = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json',
};
const readProduct =
  'SELECT p.*, s.checked_at FROM products p CROSS JOIN registry_state s WHERE s.singleton = 1 AND p.slug = ?';

function published(row, now) {
  return (
    !row.blocked &&
    row.source_active &&
    row.active_version &&
    row.ready &&
    row.checked_at >= now - policyGrace
  );
}

function publicProduct(row, now) {
  return {
    app_id: row.app_id,
    slug: row.slug,
    display_name: row.display_name,
    publisher: row.publisher,
    repository: row.repository,
    license: row.license,
    summary: { en: row.summary_en, zh: row.summary_zh },
    pc_targets: row.blocked ? [] : JSON.parse(row.pc_targets),
    capabilities: JSON.parse(row.capabilities),
    blocked: Boolean(row.blocked),
    web: published(row, now)
      ? { url: 'https://' + row.slug + '.nimi.xyz/', version: row.active_version }
      : null,
  };
}

const catalogPath = '/.well-known/nimi-apps';

async function catalog(url, db, now) {
  if (url.pathname === catalogPath) {
    const cursor = url.searchParams.get('after') ?? '';
    const { results } = await db
      .prepare(
        'SELECT p.*, s.checked_at FROM products p CROSS JOIN registry_state s WHERE s.singleton = 1 AND p.visible = 1 AND p.slug > ? ORDER BY p.slug LIMIT 51',
      )
      .bind(cursor)
      .all();
    return json({
      products: results.slice(0, 50).map((row) => publicProduct(row, now)),
      next: results.length > 50 ? results[49].slug : null,
    });
  }
  const slug = url.pathname.slice(catalogPath.length + 1);
  if (!url.pathname.startsWith(catalogPath + '/') || !/^[a-z0-9-]{1,63}$/u.test(slug))
    return error(404, 'not_found');
  const row = await db.prepare(readProduct).bind(slug).first();
  return row?.visible ? json(publicProduct(row, now)) : error(404, 'not_found');
}

function resourcePath(pathname) {
  let value;
  try {
    value = decodeURIComponent(pathname).slice(1);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/u.test(value) || value.split('/').some((x) => x === '.' || x === '..'))
    return null;
  return value;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.hosted-web-publication
export async function serveHostedWeb(request, env, context) {
  const url = new URL(request.url);
  const now = Date.now();
  if (url.hostname === 'catalog.internal' && request.method === 'GET') return catalog(url, env.DB, now);
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.nimi\.xyz$/u.exec(url.hostname);
  if (!match || url.protocol !== 'https:' || url.port) return error(404, 'unknown_host');
  const row = await env.DB.prepare(readProduct).bind(match[1]).first();
  if (!row?.client_id) return error(404, 'unknown_host');
  const cleanup =
    (request.method === 'GET' && url.pathname === '/api/runtime-access/context') ||
    (request.method === 'POST' && url.pathname === '/api/runtime-access/context/end');
  const available = !row.blocked && row.source_active && row.checked_at >= now - policyGrace;
  if (!available && !cleanup) return error(403, 'hosted_source_unavailable');
  if (isWebCoordinationPath(request.method, url.pathname)) {
    const response = await handleNimiWebCoordination({
      request,
      env: { NIMI_WEB_ORIGIN: 'https://' + row.slug + '.nimi.xyz', NIMI_REALM_URL: env.NIMI_REALM_URL },
    });
    if (!available && request.method === 'GET' && response.ok) {
      await response.body?.cancel();
      return json(
        {
          reasonCode:
            row.blocked || !row.source_active
              ? 'RUNTIME_CLIENT_SOURCE_PAUSED'
              : 'RUNTIME_CLIENT_REGISTRY_UNAVAILABLE',
        },
        row.blocked || !row.source_active ? 403 : 503,
      );
    }
    return response;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'method_not_allowed');
  if (!row.active_version) return error(404, 'not_published');
  let file = resourcePath(url.pathname);
  if (file === null || /^(?:api|\.well-known)(?:\/|$)/u.test(file) || file === 'nimi-web-bundle.json')
    return error(404, 'not_found');
  const versioned = file.startsWith('_releases/');
  const version = versioned ? file.split('/')[1] : row.active_version;
  const release = await env.DB.prepare(
    'SELECT digest FROM releases WHERE app_id=? AND version=? AND source_revision=?',
  )
    .bind(row.app_id, version, row.source_revision)
    .first();
  if (!release) return error(404, 'release_unavailable');
  const key = row.app_id + '/' + release.digest + '/';
  const navigation =
    !versioned &&
    (file === '' ||
      request.headers.get('Sec-Fetch-Mode') === 'navigate' ||
      request.headers.get('Accept')?.includes('text/html')) &&
    !/\.[^/]+$/u.test(file.split('/').at(-1));
  if (navigation || !file) file = 'index.html';
  const cache = versioned && request.method === 'GET' ? globalThis.caches?.default : null;
  const cacheKey = new Request(url.origin + '/_cache/' + release.digest + '/' + file);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const object =
    request.method === 'HEAD'
      ? await env.ASSETS_BUCKET.head(key + file)
      : await env.ASSETS_BUCKET.get(key + file);
  if (!object) return error(404, 'not_found');
  const response = new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'Content-Type': types[file.split('.').at(-1)] ?? 'application/octet-stream',
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: object.httpEtag,
      'X-Nimi-Web-Version': version,
      'X-Nimi-Web-Digest': release.digest,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      'Strict-Transport-Security': 'max-age=31536000',
    },
  });
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await serveHostedWeb(request, env, ctx);
    } catch {
      return error(503, 'hosting_unavailable');
    }
  },
};
