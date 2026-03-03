export type LandingLinks = {
  appUrl: string;
  docsUrl: string;
  githubUrl: string;
  protocolUrl: string;
};

const DEFAULT_LINKS: LandingLinks = {
  appUrl: 'https://nimi.xyz/app',
  docsUrl: 'https://nimi.xyz/docs',
  githubUrl: 'https://github.com/nimiplatform/nimi',
  protocolUrl: 'https://github.com/nimiplatform/nimi/blob/main/spec/platform/protocol.md',
};

function normalizeUrl(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return fallback;
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
    docsUrl: normalizeUrl(env.VITE_LANDING_DOCS_URL, DEFAULT_LINKS.docsUrl),
    githubUrl: normalizeUrl(env.VITE_LANDING_GITHUB_URL, DEFAULT_LINKS.githubUrl),
    protocolUrl: normalizeUrl(env.VITE_LANDING_PROTOCOL_URL, DEFAULT_LINKS.protocolUrl),
  };
}

export const landingLinkDefaults = DEFAULT_LINKS;
