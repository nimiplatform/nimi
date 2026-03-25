import {
  buildDesktopLatestManifest,
  buildRuntimeManifest,
  cacheMaxAgeSeconds,
  fetchRepositoryReleases,
  selectLatestRelease,
} from './release-feed.mjs';

function jsonResponse(payload, maxAgeSeconds) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'cache-control': `public, max-age=${maxAgeSeconds}`,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function textResponse(body, maxAgeSeconds) {
  return new Response(body, {
    headers: {
      'cache-control': `public, max-age=${maxAgeSeconds}`,
      'content-type': 'text/x-shellscript; charset=utf-8',
    },
  });
}

function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

async function fetchInstallScriptAsset(request, env, maxAgeSeconds) {
  const installScriptRequest = new Request(new URL('/install.sh', request.url));
  const assetResponse = await env.ASSETS.fetch(installScriptRequest);
  if (!assetResponse.ok) {
    return errorResponse('INSTALL_SCRIPT_NOT_FOUND', 404);
  }
  return textResponse(await assetResponse.text(), maxAgeSeconds);
}

async function resolveLatestRelease(track, env, fetchImpl) {
  const releases = await fetchRepositoryReleases(env, fetchImpl);
  const release = selectLatestRelease(releases, track);
  if (!release) {
    throw new Error(`${track.toUpperCase()}_RELEASE_NOT_FOUND`);
  }
  return release;
}

async function buildRouteResponse(request, env, fetchImpl) {
  const maxAgeSeconds = cacheMaxAgeSeconds(env);
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 405);
  }

  if (url.pathname === '/' || url.pathname === '/install.sh') {
    return fetchInstallScriptAsset(request, env, maxAgeSeconds);
  }

  if (url.pathname === '/healthz') {
    return jsonResponse({ ok: true }, maxAgeSeconds);
  }

  if (url.pathname === '/runtime/latest.json') {
    const release = await resolveLatestRelease('runtime', env, fetchImpl);
    return jsonResponse(buildRuntimeManifest(release), maxAgeSeconds);
  }

  if (url.pathname === '/desktop/latest.json') {
    const release = await resolveLatestRelease('desktop', env, fetchImpl);
    return jsonResponse(await buildDesktopLatestManifest(release, fetchImpl), maxAgeSeconds);
  }

  return errorResponse('NOT_FOUND', 404);
}

export async function handleInstallGatewayRequest(request, env, ctx, options = {}) {
  const cache = globalThis.caches?.default;
  const cacheKey = request.url;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await buildRouteResponse(request, env, options.fetchImpl || fetch);
    if (cache && response.ok && request.method === 'GET') {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'UNKNOWN_ERROR');
  }
}

export default {
  fetch(request, env, ctx) {
    return handleInstallGatewayRequest(request, env, ctx);
  },
};
