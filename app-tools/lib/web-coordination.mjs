// @nimi-authority: rule.nimi.platform.app-ecosystem.scaffold-web-carrier
export function isWebCoordinationPath(method, pathname) {
  if (method === 'GET') {
    return pathname === '/api/runtime-access/context'
      || /^\/api\/runtime-access\/connections\/[A-Za-z0-9_-]+$/u.test(pathname)
      || /^\/api\/auth\/runtime-clients\/[A-Za-z0-9_.-]+$/u.test(pathname);
  }
  return method === 'POST' && (pathname === '/api/runtime-access/token'
    || pathname === '/api/runtime-access/context/end'
    || pathname === '/api/runtime-access/connections');
}

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function reject(message, status) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleNimiWebCoordination({ request, env }) {
  const source = new URL(request.url);
  if (!isWebCoordinationPath(request.method, source.pathname)) return reject('Not found', 404);

  const site = httpsOrigin(env.NIMI_WEB_ORIGIN);
  const realm = httpsOrigin(env.NIMI_REALM_URL);
  if (!site || !realm || site === realm) return reject('Coordination is not configured', 503);
  const origin = request.headers.get('origin');
  if (source.origin !== site || (origin !== null && origin !== site)) return reject('Origin is not allowed', 403);

  const headers = new Headers();
  for (const name of ['accept', 'authorization', 'content-type', 'origin']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const target = new URL(source.pathname + source.search, realm);
  let upstream;
  try {
    upstream = await fetch(target, { method: request.method, headers, body: request.body, redirect: 'manual' });
  } catch {
    return reject('Realm coordination is unavailable', 502);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    return reject('Unexpected coordination redirect', 502);
  }

  const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of ['content-type', 'retry-after']) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
