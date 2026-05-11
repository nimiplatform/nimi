export type LandingLinks = {
  appUrl: string;
  webAppUrl: string;
  discordUrl: string;
  docsUrl: string;
  githubUrl: string;
  protocolUrl: string;
  desktopDownloadUrl: string;
  modDocsUrl: string;
};

// Docs site is deployed at the docs.nimi.ai subdomain (VitePress with
// cleanUrls + locales: en at root, zh under /zh/). Locale prefixing for zh
// is applied in App.tsx via resolveLocalizedLinks(); these defaults are the
// en/root URLs.
const DEFAULT_LINKS: LandingLinks = {
  appUrl: 'https://docs.nimi.ai/start/',
  webAppUrl: '/login',
  discordUrl: 'https://discord.gg/BQwHJvPn',
  docsUrl: 'https://docs.nimi.ai/',
  githubUrl: 'https://github.com/nimiplatform/nimi',
  protocolUrl: 'https://docs.nimi.ai/platform/protocol',
  desktopDownloadUrl: 'https://docs.nimi.ai/desktop/',
  modDocsUrl: 'https://docs.nimi.ai/desktop/mod-system',
};

/**
 * Insert a locale prefix (e.g. 'zh') into a docs URL on the docs.nimi.ai
 * subdomain. en/root locale returns the URL unchanged; zh transforms
 * `https://docs.nimi.ai/<path>` → `https://docs.nimi.ai/zh/<path>`.
 *
 * Non-docs URLs (webAppUrl, discordUrl, githubUrl) pass through unchanged.
 */
function localizeDocsUrl(url: string, locale: 'en' | 'zh'): string {
  if (locale === 'en') return url;
  try {
    const parsed = new URL(url);
    if (parsed.host !== 'docs.nimi.ai') return url;
    if (parsed.pathname.startsWith('/zh/') || parsed.pathname === '/zh') return url;
    parsed.pathname = '/zh' + parsed.pathname;
    return parsed.toString();
  } catch {
    // Relative path fallback (only used if env override deviates from default).
    if (url.startsWith('/docs/zh/')) return url;
    if (url.startsWith('/docs/')) return '/docs/zh/' + url.slice('/docs/'.length);
    return url;
  }
}

/**
 * Apply locale prefix to all docs-pointing fields in a LandingLinks bundle.
 * Non-docs fields (webAppUrl / discordUrl / githubUrl) pass through.
 */
export function resolveLocalizedLinks(links: LandingLinks, locale: 'en' | 'zh'): LandingLinks {
  if (locale === 'en') return links;
  return {
    ...links,
    appUrl: localizeDocsUrl(links.appUrl, locale),
    docsUrl: localizeDocsUrl(links.docsUrl, locale),
    protocolUrl: localizeDocsUrl(links.protocolUrl, locale),
    desktopDownloadUrl: localizeDocsUrl(links.desktopDownloadUrl, locale),
    modDocsUrl: localizeDocsUrl(links.modDocsUrl, locale),
  };
}

function normalizeUrl(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return fallback;
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

export function resolveLandingLinks(env: Record<string, unknown> = {}): LandingLinks {
  return {
    appUrl: normalizeUrl(env.VITE_LANDING_APP_URL, DEFAULT_LINKS.appUrl),
    webAppUrl: normalizeUrl(env.VITE_LANDING_WEB_APP_URL, DEFAULT_LINKS.webAppUrl),
    discordUrl: normalizeUrl(env.VITE_LANDING_DISCORD_URL, DEFAULT_LINKS.discordUrl),
    docsUrl: normalizeUrl(env.VITE_LANDING_DOCS_URL, DEFAULT_LINKS.docsUrl),
    githubUrl: normalizeUrl(env.VITE_LANDING_GITHUB_URL, DEFAULT_LINKS.githubUrl),
    protocolUrl: normalizeUrl(env.VITE_LANDING_PROTOCOL_URL, DEFAULT_LINKS.protocolUrl),
    desktopDownloadUrl: normalizeUrl(
      env.VITE_LANDING_DESKTOP_DOWNLOAD_URL,
      DEFAULT_LINKS.desktopDownloadUrl,
    ),
    modDocsUrl: normalizeUrl(env.VITE_LANDING_MOD_DOCS_URL, DEFAULT_LINKS.modDocsUrl),
  };
}

export const landingLinkDefaults = DEFAULT_LINKS;
