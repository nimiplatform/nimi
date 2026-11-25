export const DIRECTORY_ENDPOINT = '/.well-known/nimi-apps';
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isDirectorySlug(value: unknown): value is string {
  return typeof value === 'string' && slugPattern.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDirectoryMediaUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(DIRECTORY_ENDPOINT + '/media/');
}

export function readProductSummary(value: Record<string, unknown>) {
  if (!isDirectorySlug(value.slug) || typeof value.display_name !== 'string'
    || typeof value.blocked !== 'boolean' || !isRecord(value.summary)
    || typeof value.summary.zh !== 'string' || typeof value.summary.en !== 'string') return null;

  let web: { url: string; version: string } | null = null;
  if (value.web !== null) {
    const release = value.web;
    if (!isRecord(release) || release.url !== `https://${value.slug}.nimi.xyz/`
      || typeof release.version !== 'string') return null;
    web = { url: release.url, version: release.version };
  }

  return {
    slug: value.slug,
    display_name: value.display_name,
    summary: { en: value.summary.en, zh: value.summary.zh },
    blocked: value.blocked,
    web,
    icon_url: isDirectoryMediaUrl(value.icon_url) ? value.icon_url : null,
  };
}

export async function fetchDirectoryPage(after: string | null, signal: AbortSignal) {
  const url = after ? DIRECTORY_ENDPOINT + '?after=' + encodeURIComponent(after) : DIRECTORY_ENDPOINT;
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) throw Error('Directory unavailable');
  const page: unknown = await response.json();
  if (!isRecord(page) || !Array.isArray(page.products) || !(page.next === null || isDirectorySlug(page.next))) {
    throw Error('Invalid directory page');
  }
  return { products: page.products as unknown[], next: page.next };
}
