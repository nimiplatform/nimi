const POLYINFO_DEV_UPSTREAM_PREFIX = '/__polyinfo_upstream';

function isPolyinfoDevServer(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function resolvePolyinfoUpstreamUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!isPolyinfoDevServer()) {
    return `${baseUrl}${normalizedPath}`;
  }

  const parsedBase = new URL(baseUrl);
  if (parsedBase.hostname === 'polymarket.com') {
    return `${POLYINFO_DEV_UPSTREAM_PREFIX}/polymarket${normalizedPath}`;
  }
  if (parsedBase.hostname === 'gamma-api.polymarket.com') {
    return `${POLYINFO_DEV_UPSTREAM_PREFIX}/gamma${normalizedPath}`;
  }
  if (parsedBase.hostname === 'clob.polymarket.com') {
    return `${POLYINFO_DEV_UPSTREAM_PREFIX}/clob${normalizedPath}`;
  }
  return `${baseUrl}${normalizedPath}`;
}
