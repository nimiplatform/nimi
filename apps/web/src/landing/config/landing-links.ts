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

const DEFAULT_LINKS: LandingLinks = {
  appUrl: '/#/login',
  webAppUrl: '/#/login',
  discordUrl: 'https://discord.gg/BQwHJvPn',
  docsUrl: 'https://nimi.xyz/docs',
  githubUrl: 'https://github.com/nimiplatform/nimi',
  protocolUrl: 'https://github.com/nimiplatform/nimi/blob/main/spec/platform/protocol.md',
  desktopDownloadUrl: 'https://nimi.xyz/download',
  modDocsUrl: 'https://nimi.xyz/docs/mods',
};

function normalizeUrl(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return fallback;
  }

  if (value.startsWith('/')) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return fallback;
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
    desktopDownloadUrl: normalizeUrl(env.VITE_LANDING_DESKTOP_DOWNLOAD_URL, DEFAULT_LINKS.desktopDownloadUrl),
    modDocsUrl: normalizeUrl(env.VITE_LANDING_MOD_DOCS_URL, DEFAULT_LINKS.modDocsUrl),
  };
}

export const landingLinkDefaults = DEFAULT_LINKS;
