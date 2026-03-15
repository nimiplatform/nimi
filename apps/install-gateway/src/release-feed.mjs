const DEFAULT_GITHUB_API_ORIGIN = 'https://api.github.com';
const DEFAULT_REPO_OWNER = 'nimiplatform';
const DEFAULT_REPO_NAME = 'nimi';
const DEFAULT_CACHE_MAX_AGE_SECONDS = 300;

const REQUIRED_RUNTIME_ARCHIVES = [
  'darwin-arm64',
  'darwin-amd64',
  'linux-arm64',
  'linux-amd64',
  'windows-arm64',
  'windows-amd64',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeApiOrigin(raw) {
  const value = normalizeText(raw) || DEFAULT_GITHUB_API_ORIGIN;
  return value.replace(/\/+$/u, '');
}

function normalizeRepoOwner(raw) {
  return normalizeText(raw) || DEFAULT_REPO_OWNER;
}

function normalizeRepoName(raw) {
  return normalizeText(raw) || DEFAULT_REPO_NAME;
}

function releasePublishedTimestamp(release) {
  const raw = normalizeText(release?.published_at || release?.created_at);
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? stamp : 0;
}

function runtimeTrackPrefix(track) {
  return `${normalizeText(track).replace(/\/+$/u, '')}/`;
}

function releaseTrackValues(release) {
  return [
    normalizeText(release?.tag_name),
    normalizeText(release?.name),
  ];
}

function isTruthyBoolean(value) {
  return value === true;
}

export function githubReleaseApiUrl(env = {}) {
  const apiOrigin = normalizeApiOrigin(env.GITHUB_API_ORIGIN);
  const owner = normalizeRepoOwner(env.GITHUB_REPO_OWNER);
  const repo = normalizeRepoName(env.GITHUB_REPO_NAME);
  return `${apiOrigin}/repos/${owner}/${repo}/releases?per_page=50`;
}

export function githubApiHeaders(env = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'nimi-install-gateway',
  };
  const token = normalizeText(env.GITHUB_RELEASES_TOKEN || env.GITHUB_TOKEN);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export function matchesReleaseTrack(release, track) {
  const prefix = runtimeTrackPrefix(track).toLowerCase();
  return releaseTrackValues(release).some((value) => value.toLowerCase().startsWith(prefix));
}

export function selectLatestRelease(releases, track) {
  const candidates = Array.isArray(releases)
    ? releases.filter((release) => !isTruthyBoolean(release?.draft) && matchesReleaseTrack(release, track))
    : [];
  if (candidates.length === 0) {
    return null;
  }
  const stable = candidates
    .filter((release) => !isTruthyBoolean(release?.prerelease))
    .sort((left, right) => releasePublishedTimestamp(right) - releasePublishedTimestamp(left));
  if (stable.length > 0) {
    return stable[0];
  }
  return candidates.sort((left, right) => releasePublishedTimestamp(right) - releasePublishedTimestamp(left))[0] || null;
}

export async function fetchRepositoryReleases(env = {}, fetchImpl = fetch) {
  const response = await fetchImpl(githubReleaseApiUrl(env), {
    headers: githubApiHeaders(env),
  });
  if (!response.ok) {
    throw new Error(`GITHUB_RELEASE_FETCH_FAILED: status=${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('GITHUB_RELEASE_FETCH_INVALID: expected an array');
  }
  return payload;
}

function normalizeRuntimeArchivePlatform(os, arch) {
  const osKey = os === 'macos' ? 'darwin' : os;
  return `${osKey}-${arch}`;
}

function inferRuntimeArchivePlatform(assetName) {
  const match = /^nimi-runtime_[^_]+_(macos|linux|windows)_(amd64|arm64)\.(tar\.gz|zip)$/u.exec(normalizeText(assetName));
  if (!match) {
    return '';
  }
  return normalizeRuntimeArchivePlatform(match[1], match[2]);
}

function versionFromTag(tagName, track) {
  const prefix = runtimeTrackPrefix(track);
  const raw = normalizeText(tagName);
  if (!raw.startsWith(prefix)) {
    return raw.replace(/^v/u, '');
  }
  return raw.slice(prefix.length).replace(/^v/u, '');
}

function normalizeDesktopArch(assetNameLower) {
  if (
    assetNameLower.includes('aarch64')
    || assetNameLower.includes('arm64')
  ) {
    return 'aarch64';
  }
  if (
    assetNameLower.includes('x86_64')
    || assetNameLower.includes('x64')
    || assetNameLower.includes('amd64')
  ) {
    return 'x86_64';
  }
  return '';
}

function inferDesktopPlatform(assetName) {
  const normalized = normalizeText(assetName).toLowerCase();
  if (normalized.endsWith('.sig')) {
    return '';
  }
  const arch = normalizeDesktopArch(normalized);
  if (!arch) {
    return '';
  }
  if (normalized.includes('.app.tar.gz')) {
    return `darwin-${arch}`;
  }
  if (normalized.includes('appimage') && normalized.endsWith('.tar.gz')) {
    return `linux-${arch}`;
  }
  if (normalized.includes('nsis') && normalized.endsWith('.zip')) {
    return `windows-${arch}`;
  }
  return '';
}

export function buildRuntimeManifest(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const checksumsAsset = assets.find((asset) => normalizeText(asset?.name) === 'checksums.txt');
  if (!checksumsAsset?.browser_download_url) {
    throw new Error('RUNTIME_RELEASE_INVALID: checksums.txt asset is missing');
  }

  const archives = {};
  for (const asset of assets) {
    const platform = inferRuntimeArchivePlatform(asset?.name);
    if (!platform) {
      continue;
    }
    archives[platform] = {
      name: normalizeText(asset.name),
      url: normalizeText(asset.browser_download_url),
    };
  }

  for (const platform of REQUIRED_RUNTIME_ARCHIVES) {
    if (!archives[platform]?.name || !archives[platform]?.url) {
      throw new Error(`RUNTIME_RELEASE_INVALID: archive missing for ${platform}`);
    }
  }

  return {
    tag: normalizeText(release?.tag_name),
    version: versionFromTag(release?.tag_name, 'runtime'),
    checksumsUrl: normalizeText(checksumsAsset.browser_download_url),
    archives,
  };
}

export function collectDesktopUpdaterArtifacts(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const signatures = new Map();
  for (const asset of assets) {
    const name = normalizeText(asset?.name);
    if (!name.endsWith('.sig')) {
      continue;
    }
    signatures.set(name.slice(0, -4), asset);
  }

  const artifacts = [];
  for (const asset of assets) {
    const platform = inferDesktopPlatform(asset?.name);
    if (!platform) {
      continue;
    }
    const signatureAsset = signatures.get(normalizeText(asset.name));
    if (!signatureAsset?.browser_download_url) {
      throw new Error(`DESKTOP_RELEASE_INVALID: signature missing for ${normalizeText(asset.name)}`);
    }
    artifacts.push({
      platform,
      bundleUrl: normalizeText(asset.browser_download_url),
      signatureUrl: normalizeText(signatureAsset.browser_download_url),
    });
  }

  if (artifacts.length === 0) {
    throw new Error('DESKTOP_RELEASE_INVALID: updater artifacts are missing');
  }

  return artifacts;
}

async function fetchSignatureText(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`DESKTOP_SIGNATURE_FETCH_FAILED: status=${response.status}`);
  }
  return normalizeText(await response.text());
}

export async function buildDesktopLatestManifest(release, fetchImpl = fetch) {
  const artifacts = collectDesktopUpdaterArtifacts(release);
  const platformEntries = await Promise.all(
    artifacts.map(async (artifact) => ({
      platform: artifact.platform,
      url: artifact.bundleUrl,
      signature: await fetchSignatureText(artifact.signatureUrl, fetchImpl),
    })),
  );

  const platforms = {};
  for (const entry of platformEntries) {
    if (!entry.signature) {
      throw new Error(`DESKTOP_RELEASE_INVALID: empty signature for ${entry.platform}`);
    }
    platforms[entry.platform] = {
      signature: entry.signature,
      url: entry.url,
    };
  }

  return {
    version: versionFromTag(release?.tag_name, 'desktop'),
    notes: normalizeText(release?.body) || null,
    pub_date: normalizeText(release?.published_at || release?.created_at) || null,
    platforms,
  };
}

export function cacheMaxAgeSeconds(env = {}) {
  const raw = Number(env.CACHE_MAX_AGE_SECONDS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_CACHE_MAX_AGE_SECONDS;
}
