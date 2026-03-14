function isApiRequest(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isSocketRequest(pathname) {
  return pathname === '/socket.io' || pathname.startsWith('/socket.io/');
}

function resolveApiOrigin(env) {
  const raw = String(env.API_ORIGIN || '').trim();
  if (!raw) {
    throw new Error('Missing required Pages environment variable: API_ORIGIN');
  }
  return raw.replace(/\/+$/, '');
}

function buildUpstreamUrl(requestUrl, env) {
  const upstream = new URL(requestUrl);
  const apiOrigin = new URL(resolveApiOrigin(env));
  upstream.protocol = apiOrigin.protocol;
  upstream.host = apiOrigin.host;
  return upstream;
}

function buildProxyRequest(request, upstreamUrl) {
  const headers = new Headers(request.headers);
  const incomingUrl = new URL(request.url);

  headers.set('x-forwarded-host', incomingUrl.host);
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));

  return new Request(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isApiRequest(url.pathname) || isSocketRequest(url.pathname)) {
      try {
        const upstreamUrl = buildUpstreamUrl(request.url, env);
        return fetch(buildProxyRequest(request, upstreamUrl));
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: 'proxy_configuration_error',
            message: error instanceof Error ? error.message : 'Unknown proxy configuration error',
          }),
          {
            status: 500,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
          },
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
