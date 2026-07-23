/**
 * R-OAUTH-011 split UI/API topology helper.
 *
 * The realm API authorize endpoint owns the OAuth transaction. When unauth,
 * `/api/auth/oauth/authorize` 302-redirects the user agent to the web login
 * UI with `?oauth_next=<absolute-API-authorize-URL>`. After successful login
 * the web login page navigates the user agent BACK to the API authorize
 * endpoint via `window.location.assign(oauth_next)`. The web shell never
 * parses the authorization `code`, never receives a refresh token, and never
 * calls the token exchange endpoint - it is a UI continuation only.
 *
 * To prevent open-redirect abuse the `oauth_next` URL is allowlisted against
 * the realm/API origin known to the web shell via build-time env. URLs that
 * do not match the allowlisted origin are silently dropped.
 */

function readApiOriginAllowlist(): string[] {
  const allowlist: string[] = [];
  // In Vite production / dev builds, env values are surfaced via
  // `import.meta.env`. In the Node `node:test` runtime used by the desktop
  // test harness, those values are exposed via `process.env`. Prefer the
  // Vite shape but fall back so the helper is testable without Vite.
  let viteRealmBaseUrl = '';
  try {
    viteRealmBaseUrl = String(import.meta.env.VITE_NIMI_REALM_BASE_URL || '').trim();
  } catch {
    // ignore
  }
  const processEnv = (typeof globalThis !== 'undefined'
    && (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env)
    || {};
  const candidates = [
    viteRealmBaseUrl,
    processEnv.VITE_NIMI_REALM_BASE_URL,
    processEnv.NIMI_REALM_URL,
  ];
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    try {
      const origin = new URL(raw).origin;
      if (origin && !allowlist.includes(origin)) {
        allowlist.push(origin);
      }
    } catch {
      // Skip malformed env values.
    }
  }
  return allowlist;
}

/**
 * Read the absolute `oauth_next` URL out of `window.location.search` and
 * return it iff it is a valid http(s) URL whose origin matches the apps/web
 * realm-origin allowlist. Otherwise return `null`.
 *
 * Pure: does not navigate; does not mutate any state.
 */
export function readValidatedOauthNext(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const raw = params.get('oauth_next');
  if (!raw) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  const allowlist = readApiOriginAllowlist();
  if (allowlist.length === 0) {
    // Without an allowlist there is no safe way to permit cross-origin
    // navigation - fail-close so a misconfigured deploy cannot be turned
    // into an open redirect.
    return null;
  }
  if (!allowlist.includes(parsed.origin)) {
    return null;
  }
  return parsed.toString();
}

export function readFreshOauthLoginState(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (params.get('fresh_oauth') !== '1') {
    return null;
  }
  const next = readValidatedOauthNext(search);
  if (!next) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(next);
  } catch {
    return null;
  }
  if (parsed.searchParams.get('prompt') !== 'login') {
    return null;
  }
  return parsed.searchParams.get('state') || parsed.toString();
}

export function freshOauthLoginGateStorageKey(state: string): string {
  return `nimi:fresh-oauth-login:${state}`;
}

/**
 * Navigate the user agent back to the realm API authorize endpoint using
 * `window.location.assign`. R-OAUTH-011 split UI/API topology: the web shell
 * is a UI continuation only and does not consume the OAuth `code`.
 *
 * Returns `true` iff the navigation was issued (i.e. a validated oauth_next
 * was present); the caller MAY use the return value to decide whether to
 * suppress a default in-shell `Navigate` route.
 */
export function continueOauthNextIfPresent(search: string): boolean {
  const next = readValidatedOauthNext(search);
  if (!next) {
    return false;
  }
  if (typeof window === 'undefined' || !window.location || typeof window.location.assign !== 'function') {
    return false;
  }
  window.location.assign(next);
  return true;
}
