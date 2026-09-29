import {
  cacheMaxAgeSeconds,
  fetchRepositoryReleases,
  resolveLatestRuntimeManifest,
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

// No qualifying Runtime release is an honest unavailable result, distinct
// from failing to read the admitted GitHub source.
function errorStatus(message) {
  if (message === 'RUNTIME_RELEASE_NOT_FOUND') {
    return 404;
  }
  if (/^(?:GITHUB_RELEASE_FETCH_|RUNTIME_CHECKSUM_FETCH_)/u.test(message)) {
    return 502;
  }
  return 500;
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
    const releases = await fetchRepositoryReleases(env, fetchImpl);
    return jsonResponse(await resolveLatestRuntimeManifest(releases, fetchImpl), maxAgeSeconds);
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
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return errorResponse(message, errorStatus(message));
  }
}

export default {
  fetch(request, env, ctx) {
    return handleInstallGatewayRequest(request, env, ctx);
  },
};
