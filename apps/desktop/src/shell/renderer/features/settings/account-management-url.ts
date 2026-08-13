function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function resolveAccountManagementUrl(configuredWebBaseUrl: string): string {
  const raw = configuredWebBaseUrl.trim();
  if (!raw) throw new Error('Nimi Web account management is not configured.');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Nimi Web account management URL is invalid.');
  }
  if (parsed.username || parsed.password || parsed.hash) throw new Error('Nimi Web account management URL is invalid.');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new Error('Nimi Web account management requires HTTPS.');
  }
  return new URL('/account', parsed.origin).toString();
}
