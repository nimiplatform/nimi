export function isSecureBrowserSessionOrigin(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function admittedOrigins(): readonly string[] {
  let viteRealmBaseUrl = '';
  try {
    viteRealmBaseUrl = String(import.meta.env.VITE_NIMI_REALM_BASE_URL || '').trim();
  } catch {
    // Node tests do not provide Vite's import-meta environment.
  }
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const values = [
    typeof window === 'undefined' ? '' : window.location.origin,
    viteRealmBaseUrl,
    String(processEnv?.VITE_NIMI_REALM_BASE_URL || '').trim(),
    String(processEnv?.NIMI_REALM_URL || '').trim(),
  ];
  const origins = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (isSecureBrowserSessionOrigin(parsed)) origins.add(parsed.origin);
    } catch {
      // An invalid configured origin admits nothing.
    }
  }
  return [...origins];
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005d
export function readValidatedOauthNext(search: string): string | null {
  const raw = new URLSearchParams(search).get('oauth_next');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!isSecureBrowserSessionOrigin(parsed)) return null;
    if (parsed.username || parsed.password || parsed.hash) return null;
    if (!admittedOrigins().includes(parsed.origin)) return null;
    if (parsed.pathname.replace(/\/+$/, '') !== '/api/auth/oauth/authorize') return null;
    if (!parsed.searchParams.get('state')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isFreshOauthContinuation(search: string): boolean {
  if (new URLSearchParams(search).get('fresh_oauth') !== '1') return false;
  const next = readValidatedOauthNext(search);
  return Boolean(next && new URL(next).searchParams.get('prompt') === 'login');
}

export function isFreshAccountSelection(search: string): boolean {
  if (!isFreshOauthContinuation(search)) return false;
  const next = readValidatedOauthNext(search);
  return Boolean(next && new URL(next).searchParams.get('presence_purpose') === 'nimi.account.switch');
}

export function continueOauthNext(search: string): boolean {
  const next = readValidatedOauthNext(search);
  if (!next || typeof window === 'undefined') return false;
  window.location.assign(next);
  return true;
}
