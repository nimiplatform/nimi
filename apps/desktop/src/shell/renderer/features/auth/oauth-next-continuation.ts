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

const APPS_WEB_VITE_REALM_ENV_KEYS = [
  'VITE_NIMI_REALM_BASE_URL',
  'NIMI_REALM_URL',
] as const;

function readApiOriginAllowlist(): string[] {
  const allowlist: string[] = [];
  // In Vite production / dev builds, env values are surfaced via
  // `import.meta.env`. In the Node `node:test` runtime used by the desktop
  // test harness, those values are exposed via `process.env`. Prefer the
  // Vite shape but fall back so the helper is testable without Vite.
  let env: Record<string, string | undefined> = {};
  try {
    env = (import.meta as { env?: Record<string, string | undefined> }).env || {};
  } catch {
    env = {};
  }
  const processEnv = (typeof globalThis !== 'undefined'
    && (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env)
    || {};
  for (const key of APPS_WEB_VITE_REALM_ENV_KEYS) {
    const raw = String(env[key] || processEnv[key] || '').trim();
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
