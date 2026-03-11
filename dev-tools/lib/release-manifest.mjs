import { createPrivateKey, createPublicKey, sign as signBuffer } from 'node:crypto';
import path from 'node:path';

function readReleaseEnv(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function buildReleasePublisher(rawManifest) {
  const manifestPublisher = rawManifest.publisher && typeof rawManifest.publisher === 'object'
    ? rawManifest.publisher
    : null;
  const manifestPublisherId = manifestPublisher && typeof manifestPublisher.publisherId === 'string'
    ? manifestPublisher.publisherId
    : '';
  const manifestDisplayName = manifestPublisher && typeof manifestPublisher.displayName === 'string'
    ? manifestPublisher.displayName
    : typeof rawManifest.author === 'string'
      ? rawManifest.author
      : rawManifest.author && typeof rawManifest.author === 'object' && typeof rawManifest.author.name === 'string'
        ? rawManifest.author.name
        : '';
  return {
    publisherId: readReleaseEnv('NIMI_MOD_PUBLISHER_ID', manifestPublisherId || 'community.publisher'),
    displayName: readReleaseEnv('NIMI_MOD_PUBLISHER_NAME', manifestDisplayName || 'Community Publisher'),
    trustTier: readReleaseEnv('NIMI_MOD_TRUST_TIER', 'community'),
  };
}

function buildReleaseSource(rawManifest, version) {
  const repository = typeof rawManifest.repository === 'string'
    ? rawManifest.repository
    : rawManifest.repository && typeof rawManifest.repository === 'object' && typeof rawManifest.repository.url === 'string'
      ? rawManifest.repository.url
      : '';
  return {
    repoUrl: readReleaseEnv('NIMI_MOD_SOURCE_REPO_URL', repository),
    releaseTag: readReleaseEnv('NIMI_MOD_RELEASE_TAG', `v${version}`),
  };
}

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function buildReleaseAppMetadata(packageType) {
  const appMode = normalizeOptionalString(readReleaseEnv('NIMI_MOD_APP_MODE', ''));
  const scopeCatalogVersion = normalizeOptionalString(readReleaseEnv('NIMI_MOD_SCOPE_CATALOG_VERSION', ''));
  const minRuntimeVersion = normalizeOptionalString(readReleaseEnv('NIMI_MOD_MIN_RUNTIME_VERSION', ''));
  if (packageType !== 'nimi-app') {
    if (appMode || scopeCatalogVersion || minRuntimeVersion) {
      throw new Error('nimi-app reserved release fields are only allowed when NIMI_MOD_PACKAGE_TYPE=nimi-app');
    }
    return {};
  }
  return {
    ...(appMode ? { appMode } : {}),
    ...(scopeCatalogVersion ? { scopeCatalogVersion } : {}),
    ...(minRuntimeVersion ? { minRuntimeVersion } : {}),
  };
}

function createReleaseSignaturePayload(releaseManifest) {
  return {
    packageType: releaseManifest.packageType,
    packageId: releaseManifest.packageId,
    version: releaseManifest.version,
    channel: releaseManifest.channel,
    artifactUrl: releaseManifest.artifactUrl,
    sha256: releaseManifest.sha256,
    signerId: releaseManifest.signerId,
    minDesktopVersion: releaseManifest.minDesktopVersion,
    minHookApiVersion: releaseManifest.minHookApiVersion,
    capabilities: [...releaseManifest.capabilities],
    requiresReconsentOnCapabilityIncrease: releaseManifest.requiresReconsentOnCapabilityIncrease,
    publisher: {
      publisherId: releaseManifest.publisher.publisherId,
      displayName: releaseManifest.publisher.displayName,
      trustTier: releaseManifest.publisher.trustTier,
    },
    source: {
      repoUrl: releaseManifest.source.repoUrl,
      releaseTag: releaseManifest.source.releaseTag,
    },
    state: {
      listed: Boolean(releaseManifest.state.listed),
      yanked: Boolean(releaseManifest.state.yanked),
      quarantined: Boolean(releaseManifest.state.quarantined),
    },
    ...(releaseManifest.packageType === 'nimi-app' && releaseManifest.appMode
      ? { appMode: releaseManifest.appMode }
      : {}),
    ...(releaseManifest.packageType === 'nimi-app' && releaseManifest.scopeCatalogVersion
      ? { scopeCatalogVersion: releaseManifest.scopeCatalogVersion }
      : {}),
    ...(releaseManifest.packageType === 'nimi-app' && releaseManifest.minRuntimeVersion
      ? { minRuntimeVersion: releaseManifest.minRuntimeVersion }
      : {}),
  };
}

function toCanonicalReleaseBytes(releaseManifest) {
  return Buffer.from(JSON.stringify(createReleaseSignaturePayload(releaseManifest)), 'utf8');
}

function signReleaseManifest(releaseManifest) {
  const signingKeyPem = readReleaseEnv('NIMI_MOD_SIGNING_KEY');
  if (!signingKeyPem) {
    return {
      signerId: releaseManifest.signerId,
      signature: readReleaseEnv('NIMI_MOD_SIGNATURE', ''),
      publicKey: readReleaseEnv('NIMI_MOD_PUBLIC_KEY', ''),
    };
  }
  const privateKey = createPrivateKey(signingKeyPem);
  const publicKey = createPublicKey(privateKey).export({
    type: 'spki',
    format: 'pem',
  }).toString();
  const signature = signBuffer(null, toCanonicalReleaseBytes(releaseManifest), privateKey).toString('base64');
  return {
    signerId: releaseManifest.signerId,
    signature,
    publicKey,
  };
}

export function createReleaseManifest(config, outputFile, sha256, defaults) {
  const version = String(config.manifest.raw.version || '0.1.0').trim() || '0.1.0';
  const packageType = readReleaseEnv('NIMI_MOD_PACKAGE_TYPE', 'desktop-mod');
  const releaseManifest = {
    packageType,
    packageId: config.manifest.id,
    version,
    channel: readReleaseEnv('NIMI_MOD_RELEASE_CHANNEL', 'stable'),
    artifactUrl: readReleaseEnv('NIMI_MOD_ARTIFACT_URL', path.basename(outputFile)),
    sha256,
    signature: '',
    signerId: readReleaseEnv('NIMI_MOD_SIGNER_ID', `${config.manifest.id}.default`),
    minDesktopVersion: readReleaseEnv('NIMI_MOD_MIN_DESKTOP_VERSION', defaults.defaultDesktopVersion),
    minHookApiVersion: readReleaseEnv('NIMI_MOD_MIN_HOOK_API_VERSION', defaults.defaultHookApiVersion),
    capabilities: normalizeStringArray(config.manifest.raw.capabilities),
    requiresReconsentOnCapabilityIncrease: readReleaseEnv('NIMI_MOD_REQUIRES_RECONSENT', '').toLowerCase() === 'true',
    publisher: buildReleasePublisher(config.manifest.raw),
    source: buildReleaseSource(config.manifest.raw, version),
    state: {
      listed: readReleaseEnv('NIMI_MOD_LISTED', 'true').toLowerCase() !== 'false',
      yanked: readReleaseEnv('NIMI_MOD_YANKED', '').toLowerCase() === 'true',
      quarantined: readReleaseEnv('NIMI_MOD_QUARANTINED', '').toLowerCase() === 'true',
    },
    ...buildReleaseAppMetadata(packageType),
  };
  const signed = signReleaseManifest(releaseManifest);
  releaseManifest.signature = signed.signature;
  releaseManifest.signerId = signed.signerId;
  return releaseManifest;
}
