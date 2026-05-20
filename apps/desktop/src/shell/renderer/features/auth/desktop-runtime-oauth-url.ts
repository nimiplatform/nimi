export function validateRuntimeOAuthAuthorizationUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error('Runtime account login did not return an OAuth authorization URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Runtime account login returned an invalid OAuth authorization URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Runtime account login returned a non-HTTP OAuth authorization URL');
  }
  if (parsed.hostname === 'auth.nimi.invalid') {
    throw new Error('Runtime account login returned an unavailable OAuth authority');
  }
  if (parsed.hash) {
    throw new Error('Runtime account login returned an OAuth authorization URL with a fragment');
  }
  if (!parsed.pathname.replace(/\/+$/, '').endsWith('/oauth/authorize')) {
    throw new Error('Runtime account login returned a non-authorize OAuth URL');
  }
  if (parsed.searchParams.has('desktop_callback') || parsed.searchParams.has('desktop_state')) {
    throw new Error('Runtime account login returned a retired desktop relay URL');
  }

  return parsed.toString();
}
