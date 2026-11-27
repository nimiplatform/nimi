import { handleNimiWebCoordination, isWebCoordinationPath } from '../../app-tools/lib/web-coordination.mjs';
import { compareSemverDesc } from './semver.mjs';

const json = (data, status = 200, method = 'GET') =>
  new Response(method === 'HEAD' ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
const error = (status, reason, method = 'GET') => json({ error: reason }, status, method);
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
  'SELECT p.* FROM products p CROSS JOIN registry_state s WHERE s.singleton = 1 AND p.slug = ?';
const readCatalogRow =
  'SELECT p.*, sf.primary_version, sf.target_releases_json, sf.capabilities_json AS sf_capabilities_json, sf.has_storefront, sf.category, sf.default_locale, sf.summary_en AS sf_summary_en, sf.summary_zh AS sf_summary_zh, sf.tags_json, sf.icon_asset, sf.cover_assets_json FROM products p CROSS JOIN registry_state s LEFT JOIN storefront_catalog sf ON sf.app_id = p.app_id WHERE s.singleton = 1 AND p.slug = ?';
const listCatalogRows =
  'SELECT p.*, sf.primary_version, sf.target_releases_json, sf.capabilities_json AS sf_capabilities_json, sf.has_storefront, sf.category, sf.default_locale, sf.summary_en AS sf_summary_en, sf.summary_zh AS sf_summary_zh, sf.tags_json, sf.icon_asset, sf.cover_assets_json FROM products p CROSS JOIN registry_state s LEFT JOIN storefront_catalog sf ON sf.app_id = p.app_id WHERE s.singleton = 1 AND p.visible = 1 AND p.slug > ? ORDER BY p.slug LIMIT 51';

const appIdPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
const mediaFilenamePattern = /^[0-9a-f]{64}\.(?:png|webp)$/u;

function webSourceAvailable(row) {
  return Boolean(!row.blocked && row.source_active);
}

function published(row) {
  return Boolean(webSourceAvailable(row) && row.active_version && row.ready);
}

function parseJsonSafe(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mediaUrl(appId, filename) {
  return filename ? `${catalogPath}/media/${encodeURIComponent(appId)}/${filename}` : null;
}

function mapCoverUrls(appId, coverAssets) {
  if (!coverAssets?.default) return null;
  const out = { default: mediaUrl(appId, coverAssets.default) };
  if (coverAssets.locales && typeof coverAssets.locales === 'object') {
    const locales = {};
    for (const [locale, filename] of Object.entries(coverAssets.locales)) {
      if (typeof filename === 'string' && filename) locales[locale] = mediaUrl(appId, filename);
    }
    if (Object.keys(locales).length > 0) out.locales = locales;
  }
  return out;
}

function mapDocStorefrontMediaUrls(appId, media) {
  if (!media) return null;
  const mapRef = (ref) => ({
    ...ref,
    url: mediaUrl(appId, `${ref.sha256}.${ref.media_type === 'image/png' ? 'png' : 'webp'}`),
  });
  const out = {};
  if (media.cover) {
    out.cover = {
      default: mapRef(media.cover.default),
      ...(media.cover.locales
        ? {
            locales: Object.fromEntries(
              Object.entries(media.cover.locales).map(([locale, ref]) => [locale, mapRef(ref)]),
            ),
          }
        : {}),
    };
  }
  if (Array.isArray(media.gallery) && media.gallery.length > 0) {
    out.gallery = media.gallery.map((item) => ({
      id: item.id,
      kind: item.kind,
      default: mapRef(item.default),
      ...(item.locales
        ? {
            locales: Object.fromEntries(
              Object.entries(item.locales).map(([locale, ref]) => [locale, mapRef(ref)]),
            ),
          }
        : {}),
      ...(item.caption ? { caption: item.caption } : {}),
    }));
  }
  return out;
}

function resolvePolicyTargetVersions(row, blocked) {
  if (blocked) return {};
  const parsed = parseJsonSafe(row.pc_target_versions_json, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function resolveAuthoritativeTargetReleases(policyVersions, sfReleases) {
  const policyKeys = Object.keys(policyVersions).sort();
  const out = {};
  for (const tid of policyKeys) {
    const version = policyVersions[tid];
    if (typeof version !== 'string' || !version) continue;
    const synced = sfReleases?.[tid];
    out[tid] = {
      version,
      ...(synced?.version === version && typeof synced?.size === 'number' ? { size: synced.size } : {}),
    };
  }
  return out;
}

function resolveExpectedPrimaryVersion(policyVersions) {
  const versions = Array.from(new Set(Object.values(policyVersions).filter((v) => typeof v === 'string' && v.length > 0)));
  versions.sort(compareSemverDesc);
  return versions[0] ?? null;
}

function publicProduct(row) {
  const blocked = Boolean(row.blocked);
  const pcTargets = blocked ? [] : parseJsonSafe(row.pc_targets, []);
  const policyTargetVersions = resolvePolicyTargetVersions(row, blocked);
  const sfTargetReleases = blocked ? {} : parseJsonSafe(row.target_releases_json, {});
  const targetReleases = resolveAuthoritativeTargetReleases(policyTargetVersions, sfTargetReleases);
  const expectedPrimaryVersion = resolveExpectedPrimaryVersion(policyTargetVersions);
  const storefrontSynced = expectedPrimaryVersion !== null && row.primary_version === expectedPrimaryVersion;
  const hasStorefront = !blocked && storefrontSynced && Boolean(row.has_storefront);
  const summary =
    !blocked && storefrontSynced && (hasStorefront || (row.sf_summary_en && row.sf_summary_zh))
      ? { en: row.sf_summary_en ?? row.summary_en, zh: row.sf_summary_zh ?? row.summary_zh }
      : { en: row.summary_en, zh: row.summary_zh };
  const coverAssets = !blocked && storefrontSynced ? parseJsonSafe(row.cover_assets_json, null) : null;
  const webCapabilities = parseJsonSafe(row.capabilities, []);
  const sfCapabilities = storefrontSynced ? parseJsonSafe(row.sf_capabilities_json, []) : [];
  const mergedCapabilities = blocked ? [] : Array.from(new Set([...webCapabilities, ...sfCapabilities])).sort();
  return {
    app_id: row.app_id,
    slug: row.slug,
    display_name: row.display_name,
    publisher: row.publisher,
    repository: row.repository,
    license: row.license,
    summary,
    origin: row.origin ?? null,
    upstream: parseJsonSafe(row.upstream_json, null),
    pc_targets: pcTargets,
    pc_target_releases: targetReleases,
    displayed_version: blocked ? null : expectedPrimaryVersion,
    capabilities: mergedCapabilities,
    blocked,
    web: published(row)
      ? { url: 'https://' + row.slug + '.nimi.xyz/', version: row.active_version }
      : null,
    has_storefront: hasStorefront,
    category: !blocked && storefrontSynced ? row.category ?? null : null,
    default_locale: !blocked && storefrontSynced ? row.default_locale ?? null : null,
    tags: !blocked && storefrontSynced ? parseJsonSafe(row.tags_json, {}) : {},
    icon_url: !blocked && storefrontSynced ? mediaUrl(row.app_id, row.icon_asset) : null,
    cover_urls: mapCoverUrls(row.app_id, coverAssets),
  };
}

const catalogPath = '/.well-known/nimi-apps';

function etagMatches(ifNoneMatch, httpEtag) {
  if (!ifNoneMatch || !httpEtag) return false;
  const stripWeak = (value) => value.trim().replace(/^W\//u, '');
  const target = stripWeak(httpEtag);
  return ifNoneMatch
    .split(',')
    .some((candidate) => candidate.trim() === '*' || stripWeak(candidate) === target);
}

async function serveCatalogMedia(url, method, ifNoneMatch, db, bucket) {
  const suffix = url.pathname.slice((catalogPath + '/media/').length);
  const parts = suffix.split('/');
  if (parts.length !== 2) return error(404, 'not_found', method);
  let appId;
  try {
    appId = decodeURIComponent(parts[0]);
  } catch {
    return error(404, 'not_found', method);
  }
  const filename = parts[1];
  if (!appIdPattern.test(appId) || !mediaFilenamePattern.test(filename)) {
    return error(404, 'not_found', method);
  }
  const product = await db.prepare('SELECT visible, blocked FROM products WHERE app_id = ?').bind(appId).first();
  if (!product || !product.visible || product.blocked) return error(404, 'not_found', method);
  const key = `storefront-media/${appId}/${filename}`;
  const object = method === 'HEAD' || ifNoneMatch ? await bucket.head(key) : await bucket.get(key);
  if (!object) return error(404, 'not_found', method);
  const ext = filename.endsWith('.png') ? 'png' : 'webp';
  const headers = {
    'Content-Type': types[ext],
    'Cache-Control': 'public, max-age=3600, must-revalidate',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
  };
  if (ifNoneMatch && etagMatches(ifNoneMatch, object.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }
  const bodyObject = method === 'HEAD' ? null : object.body ? object : await bucket.get(key);
  if (method !== 'HEAD' && !bodyObject) return error(404, 'not_found', method);
  return new Response(method === 'HEAD' ? null : bodyObject.body, {
    status: 200,
    headers,
  });
}

function versionDisplayFields(appId, doc, mappedMedia, row) {
  const sf = doc.storefront ?? null;
  if (!sf) {
    return {
      display_name: doc.display_name,
      summary: {
        en: row.summary_en || doc.summary,
        zh: row.summary_zh || doc.summary,
      },
      has_storefront: false,
      category: null,
      default_locale: null,
      tags: {},
      cover_urls: null,
    };
  }
  const defaultLocale = sf.default_locale;
  const locales = sf.locales ?? {};
  const summaryFor = (locale) => (defaultLocale === locale ? doc.summary : locales[locale]?.summary || doc.summary);
  const tags = {};
  for (const [locale, entry] of Object.entries(locales)) {
    if (Array.isArray(entry?.tags) && entry.tags.length > 0) tags[locale] = entry.tags;
  }
  let coverUrls = null;
  if (mappedMedia?.cover?.default?.url) {
    coverUrls = { default: mappedMedia.cover.default.url };
    if (mappedMedia.cover.locales && Object.keys(mappedMedia.cover.locales).length > 0) {
      coverUrls.locales = Object.fromEntries(
        Object.entries(mappedMedia.cover.locales).map(([locale, ref]) => [locale, ref.url]),
      );
    }
  }
  return {
    display_name: doc.display_name,
    summary: { en: summaryFor('en'), zh: summaryFor('zh') },
    has_storefront: true,
    category: sf.category ?? null,
    default_locale: defaultLocale ?? null,
    tags,
    cover_urls: coverUrls,
  };
}

async function catalog(url, method, ifNoneMatch, db, bucket) {
  if (url.pathname.startsWith(catalogPath + '/media/')) {
    return serveCatalogMedia(url, method, ifNoneMatch, db, bucket);
  }
  if (url.pathname === catalogPath) {
    const cursor = url.searchParams.get('after') ?? '';
    const { results } = await db.prepare(listCatalogRows).bind(cursor).all();
    return json(
      {
        products: results.slice(0, 50).map((row) => publicProduct(row)),
        next: results.length > 50 ? results[49].slug : null,
      },
      200,
      method,
    );
  }
  const slug = url.pathname.slice(catalogPath.length + 1);
  if (!url.pathname.startsWith(catalogPath + '/') || !/^[a-z0-9-]{1,63}$/u.test(slug)) {
    return error(404, 'not_found', method);
  }
  const row = await db.prepare(readCatalogRow).bind(slug).first();
  if (!row || !row.visible) return error(404, 'not_found', method);
  const base = publicProduct(row);
  if (base.blocked) {
    return json({ ...base, detail_status: 'blocked', detail: null }, 200, method);
  }
  const requestedVersion = url.searchParams.get('version');
  const pcTargets = base.pc_targets;
  const expectedPrimaryVersion = base.displayed_version;
  if (pcTargets.length === 0 && !expectedPrimaryVersion) {
    if (requestedVersion) return error(404, 'version_not_found', method);
    return json({ ...base, detail_status: 'product_only', detail: null }, 200, method);
  }
  const targetReleases = base.pc_target_releases;
  const activeVersions = new Set(
    Object.values(targetReleases)
      .map((entry) => entry?.version)
      .filter((v) => typeof v === 'string' && v.length > 0),
  );
  const version = requestedVersion ?? expectedPrimaryVersion ?? null;
  if (requestedVersion && !activeVersions.has(requestedVersion)) {
    return error(404, 'version_not_found', method);
  }
  if (!version) {
    return json({ ...base, detail_status: 'pending', detail: null }, 200, method);
  }
  const docKey = `storefront-docs/${row.app_id}/${version}.json`;
  const docObject = await bucket.get(docKey);
  if (!docObject) {
    return json({ ...base, displayed_version: version, detail_status: 'pending', detail: null }, 200, method);
  }
  const doc = JSON.parse(await docObject.text());
  const mappedMedia = doc.storefront ? mapDocStorefrontMediaUrls(row.app_id, doc.storefront.media) : null;
  const displayFields = versionDisplayFields(row.app_id, doc, mappedMedia, row);
  const detail = {
    version: doc.version,
    display_name: doc.display_name,
    summary: doc.summary,
    readme_markdown: doc.readme_markdown,
    release_notes_markdown: doc.release_notes_markdown ?? '',
    license: doc.license,
    author: doc.author ?? '',
    homepage_url: doc.homepage_url ?? '',
    support_url: doc.support_url ?? '',
    app_access: doc.app_access ?? [],
    capability_contract_refs: doc.capability_contract_refs ?? [],
    required_standardized_feature_refs: doc.required_standardized_feature_refs ?? [],
    storage_policy: doc.storage_policy ?? null,
    safety_profile: doc.safety_profile ?? null,
    admission_trust_tier: doc.admission_trust_tier ?? null,
    icon_url: mediaUrl(row.app_id, doc.icon_asset),
    storefront: doc.storefront
      ? {
          category: doc.storefront.category,
          default_locale: doc.storefront.default_locale,
          locales: doc.storefront.locales ?? {},
          media: mappedMedia,
        }
      : null,
  };
  return json(
    {
      ...base,
      ...displayFields,
      displayed_version: version,
      capabilities: Array.from(new Set([...parseJsonSafe(row.capabilities, []), ...(detail.capability_contract_refs || [])])).sort(),
      icon_url: detail.icon_url,
      detail_status: 'published',
      detail,
    },
    200,
    method,
  );
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
  if (url.hostname === 'catalog.internal' && (request.method === 'GET' || request.method === 'HEAD')) {
    return catalog(url, request.method, request.headers.get('If-None-Match'), env.DB, env.ASSETS_BUCKET);
  }
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.nimi\.xyz$/u.exec(url.hostname);
  if (!match || url.protocol !== 'https:' || url.port) return error(404, 'unknown_host');
  const row = await env.DB.prepare(readProduct).bind(match[1]).first();
  if (!row?.client_id) return error(404, 'unknown_host');
  const cleanup =
    (request.method === 'GET' && url.pathname === '/api/runtime-access/context') ||
    (request.method === 'POST' && url.pathname === '/api/runtime-access/context/end');
  const available = webSourceAvailable(row);
  if (!available && !cleanup) return error(403, 'hosted_source_unavailable', request.method);
  if (isWebCoordinationPath(request.method, url.pathname)) {
    const response = await handleNimiWebCoordination({
      request,
      env: { NIMI_WEB_ORIGIN: 'https://' + row.slug + '.nimi.xyz', NIMI_REALM_URL: env.NIMI_REALM_URL },
    });
    if (!available && request.method === 'GET' && response.ok) {
      await response.body?.cancel();
      return json({ reasonCode: 'RUNTIME_CLIENT_SOURCE_PAUSED' }, 403);
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
