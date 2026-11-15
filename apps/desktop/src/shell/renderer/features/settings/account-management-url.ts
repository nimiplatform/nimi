function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function resolveAccountManagementUrl(configuredWebBaseUrl: string, page: 'security' | 'runtime' = 'security'): string {
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
  if (page === 'runtime' && parsed.protocol !== 'https:') throw new Error('Nimi Runtime web management requires an admitted HTTPS deployment.');
  return new URL(`/account/${page}`, parsed.origin).toString();
}
