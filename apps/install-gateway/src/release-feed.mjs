const ADMITTED_GITHUB_API_ORIGIN = 'https://api.github.com';
const ADMITTED_REPO_OWNER = 'nimiplatform';
const ADMITTED_REPO_NAME = 'nimi';
const DEFAULT_CACHE_MAX_AGE_SECONDS = 300;

// A Runtime-only release is identified only by runtime/v<SemVer> (P-GOV-028).
// The complete Nimi bundle (nimi/v), Desktop (desktop/v), component families
// and bare v<SemVer> tags belong to other owners and never enter this feed.
const RUNTIME_RELEASE_TAG = /^runtime\/v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))(-rc\.[1-9]\d*)?$/u;

// GoReleaser archives: the final Runtime version, macOS named macos, Windows zip.
const RUNTIME_ARCHIVES = [
  { platform: 'darwin-arm64', os: 'macos', arch: 'arm64', extension: 'tar.gz' },
  { platform: 'darwin-amd64', os: 'macos', arch: 'amd64', extension: 'tar.gz' },
  { platform: 'linux-arm64', os: 'linux', arch: 'arm64', extension: 'tar.gz' },
  { platform: 'linux-amd64', os: 'linux', arch: 'amd64', extension: 'tar.gz' },
  { platform: 'windows-arm64', os: 'windows', arch: 'arm64', extension: 'zip' },
  { platform: 'windows-amd64', os: 'windows', arch: 'amd64', extension: 'zip' },
];
const CHECKSUMS_ASSET_NAME = 'checksums.txt';
const GITHUB_SHA256_DIGEST = /^sha256:([a-f0-9]{64})$/u;
// sha256sum text mode, as GoReleaser writes it and install.sh reads it.
const CHECKSUM_LINE = /^([a-f0-9]{64}) {2}([^\s/\\]+)$/u;

// A release that exists but does not qualify for the feed.
export class RuntimeReleaseInvalidError extends Error {
  constructor(detail) {
    super(`RUNTIME_RELEASE_INVALID: ${detail}`);
    this.name = 'RuntimeReleaseInvalidError';
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

export function parseRuntimeReleaseTag(tagName) {
  const tag = normalizeText(tagName);
  const match = RUNTIME_RELEASE_TAG.exec(tag);
  if (!match) {
    return null;
  }
  return {
    tag,
    version: match[1],
    core: [Number(match[2]), Number(match[3]), Number(match[4])],
    releaseCandidate: Boolean(match[5]),
  };
}

export function matchesRuntimeRelease(release) {
  return Boolean(parseRuntimeReleaseTag(release?.tag_name));
}

export function githubReleaseApiUrl(env = {}) {
  void env;
  return `${ADMITTED_GITHUB_API_ORIGIN}/repos/${ADMITTED_REPO_OWNER}/${ADMITTED_REPO_NAME}/releases?per_page=50`;
}

export function githubApiHeaders(env = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'nimi-install-gateway',
  };
  const token = normalizeText(env.NIMI_GITHUB_RELEASES_TOKEN || env.GITHUB_TOKEN);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
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

export function runtimeArchiveName(version, archive) {
  return `nimi-runtime_${version}_${archive.os}_${archive.arch}.${archive.extension}`;
}

// A usable asset is fully uploaded and carries GitHub's own SHA-256 digest.
function uploadedAsset(assets, name) {
  const asset = assets.find((candidate) => normalizeText(candidate?.name) === name);
  const url = normalizeText(asset?.browser_download_url);
  const digest = GITHUB_SHA256_DIGEST.exec(normalizeText(asset?.digest));
  if (!asset || !url || asset.state !== 'uploaded' || !digest) {
    return null;
  }
  return { name, url, sha256: digest[1] };
}

function runtimeReleaseAssets(release) {
  const parsed = parseRuntimeReleaseTag(release?.tag_name);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  if (!parsed) {
    return { parsed: null, checksums: null, archives: {}, missing: ['runtime/v release tag'] };
  }
  const checksums = uploadedAsset(assets, CHECKSUMS_ASSET_NAME);
  const archives = {};
  const missing = checksums ? [] : [CHECKSUMS_ASSET_NAME];
  for (const archive of RUNTIME_ARCHIVES) {
    const asset = uploadedAsset(assets, runtimeArchiveName(parsed.version, archive));
    if (asset) {
      archives[archive.platform] = asset;
    } else {
      missing.push(runtimeArchiveName(parsed.version, archive));
    }
  }
  return { parsed, checksums, archives, missing };
}

export function hasCompleteRuntimeAssetSet(release) {
  return runtimeReleaseAssets(release).missing.length === 0;
}

function isStableRuntimeRelease(release) {
  const parsed = parseRuntimeReleaseTag(release?.tag_name);
  return Boolean(parsed && !parsed.releaseCandidate && release?.draft !== true && release?.prerelease !== true);
}

function compareVersionsDescending(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return right[index] - left[index];
    }
  }
  return 0;
}

// Stable Runtime releases with a complete asset set, highest version first.
export function runtimeReleaseCandidates(releases) {
  if (!Array.isArray(releases)) {
    return [];
  }
  return releases
    .filter((release) => isStableRuntimeRelease(release) && hasCompleteRuntimeAssetSet(release))
    .sort((left, right) => compareVersionsDescending(
      parseRuntimeReleaseTag(left.tag_name).core,
      parseRuntimeReleaseTag(right.tag_name).core,
    ));
}

export function parseRuntimeChecksums(checksumsText) {
  const checksums = new Map();
  String(checksumsText || '').split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    const match = CHECKSUM_LINE.exec(line);
    if (!match) {
      throw new RuntimeReleaseInvalidError(`checksum line ${index + 1} is not "<sha256>  <file>"`);
    }
    if (checksums.has(match[2])) {
      throw new RuntimeReleaseInvalidError(`checksum for ${match[2]} appears more than once`);
    }
    checksums.set(match[2], match[1]);
  });
  if (checksums.size === 0) {
    throw new RuntimeReleaseInvalidError('checksum evidence is empty');
  }
  return checksums;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The checksum file must be the uploaded asset GitHub digested, and every
// archive entry must equal GitHub's digest of that archive's uploaded bytes.
async function fetchVerifiedChecksums(checksumsAsset, fetchImpl) {
  const response = await fetchImpl(checksumsAsset.url);
  if (!response.ok) {
    throw new Error(`RUNTIME_CHECKSUM_FETCH_FAILED: status=${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256Hex(bytes) !== checksumsAsset.sha256) {
    throw new RuntimeReleaseInvalidError(`${CHECKSUMS_ASSET_NAME} does not match its GitHub asset digest`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RuntimeReleaseInvalidError(`${CHECKSUMS_ASSET_NAME} is not UTF-8 text`);
  }
  return parseRuntimeChecksums(text);
}

export async function buildRuntimeManifest(release, fetchImpl = fetch) {
  const { parsed, checksums, archives, missing } = runtimeReleaseAssets(release);
  if (!parsed) {
    throw new RuntimeReleaseInvalidError('release tag is not runtime/v<SemVer>');
  }
  if (missing.length > 0) {
    throw new RuntimeReleaseInvalidError(`uploaded asset with GitHub digest missing: ${missing.join(', ')}`);
  }
  const recorded = await fetchVerifiedChecksums(checksums, fetchImpl);
  for (const archive of RUNTIME_ARCHIVES) {
    const asset = archives[archive.platform];
    const checksum = recorded.get(asset.name);
    if (!checksum) {
      throw new RuntimeReleaseInvalidError(`checksum missing for ${asset.name}`);
    }
    if (checksum !== asset.sha256) {
      throw new RuntimeReleaseInvalidError(`checksum for ${asset.name} does not match its GitHub asset digest`);
    }
  }
  return {
    tag: parsed.tag,
    version: parsed.version,
    checksumsUrl: checksums.url,
    archives,
  };
}

// The newest qualifying release wins; releases that fail verification are
// skipped, while upstream fetch failures still fail the request.
export async function resolveLatestRuntimeManifest(releases, fetchImpl = fetch) {
  for (const release of runtimeReleaseCandidates(releases)) {
    try {
      return await buildRuntimeManifest(release, fetchImpl);
    } catch (error) {
      if (!(error instanceof RuntimeReleaseInvalidError)) {
        throw error;
      }
    }
  }
  throw new Error('RUNTIME_RELEASE_NOT_FOUND');
}

export function cacheMaxAgeSeconds(env = {}) {
  const raw = Number(env.CACHE_MAX_AGE_SECONDS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_CACHE_MAX_AGE_SECONDS;
}
