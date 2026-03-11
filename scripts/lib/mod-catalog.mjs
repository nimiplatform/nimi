import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const SUPPORTED_PACKAGE_TYPES = new Set(['desktop-mod', 'nimi-app']);
const NIMI_APP_ONLY_FIELDS = [
  ['appMode', 'appMode'],
  ['scopeCatalogVersion', 'scopeCatalogVersion'],
  ['minRuntimeVersion', 'minRuntimeVersion'],
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYamlOrJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    return JSON.parse(raw);
  }
  return parseYaml(raw);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function compareVersions(left, right) {
  const toSegments = (value) => String(value || '').trim().replace(/^v/i, '').split('.').map((item) => Number.parseInt(item, 10) || 0);
  const leftSegments = toSegments(left);
  const rightSegments = toSegments(right);
  const maxLen = Math.max(leftSegments.length, rightSegments.length);
  for (let index = 0; index < maxLen; index += 1) {
    const a = leftSegments[index] || 0;
    const b = rightSegments[index] || 0;
    if (a !== b) return a - b;
  }
  return 0;
}

function sortReleaseRecords(releases) {
  return releases.slice().sort((left, right) => compareVersions(right.version, left.version));
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function findManifestFile(modDir) {
  const candidates = ['mod.manifest.yaml', 'mod.manifest.yml', 'mod.manifest.json'];
  for (const candidate of candidates) {
    const filePath = path.join(modDir, candidate);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function ensureNonEmptyString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function validatePublisher(publisher, label) {
  const record = ensureObject(publisher, label);
  ensureNonEmptyString(record.publisherId, `${label}.publisherId`);
  ensureNonEmptyString(record.displayName, `${label}.displayName`);
  ensureNonEmptyString(record.trustTier, `${label}.trustTier`);
}

function validateState(state, label) {
  const record = ensureObject(state, label);
  for (const field of ['listed', 'yanked', 'quarantined']) {
    if (typeof record[field] !== 'boolean') {
      throw new Error(`${label}.${field} must be boolean`);
    }
  }
}

function validateSignerRecord(signerId, signer, label) {
  const record = ensureObject(signer, label);
  const normalizedSignerId = ensureNonEmptyString(signerId, `${label}.signerId`);
  const embeddedSignerId = ensureNonEmptyString(record.signerId || normalizedSignerId, `${label}.signerId`);
  if (embeddedSignerId !== normalizedSignerId) {
    throw new Error(`${label}.signerId must match registry key ${normalizedSignerId}`);
  }
  const algorithm = ensureNonEmptyString(record.algorithm, `${label}.algorithm`).toLowerCase();
  if (algorithm !== 'ed25519') {
    throw new Error(`${label}.algorithm must be ed25519`);
  }
  ensureNonEmptyString(record.publicKey, `${label}.publicKey`);
}

function validateNimiAppOnlyFields(record, packageType, label) {
  for (const [field, displayName] of NIMI_APP_ONLY_FIELDS) {
    const value = normalizeOptionalString(record[field]);
    if (!value) continue;
    if (packageType !== 'nimi-app') {
      throw new Error(`${label}.${displayName} is only allowed for packageType=nimi-app`);
    }
  }
}

function pickNimiAppOnlyFields(record) {
  const result = {};
  for (const [field] of NIMI_APP_ONLY_FIELDS) {
    const value = normalizeOptionalString(record[field]);
    if (value) {
      result[field] = value;
    }
  }
  return result;
}

function validateReleaseRecord(release, { signerRegistry, label = 'release' } = {}) {
  const record = ensureObject(release, label);
  const packageType = ensureNonEmptyString(record.packageType, `${label}.packageType`);
  if (!SUPPORTED_PACKAGE_TYPES.has(packageType)) {
    throw new Error(`${label}.packageType must be one of ${Array.from(SUPPORTED_PACKAGE_TYPES).join(', ')}`);
  }
  ensureNonEmptyString(record.packageId, `${label}.packageId`);
  ensureNonEmptyString(record.version, `${label}.version`);
  ensureNonEmptyString(record.channel, `${label}.channel`);
  ensureNonEmptyString(record.artifactUrl, `${label}.artifactUrl`);
  ensureNonEmptyString(record.sha256, `${label}.sha256`);
  ensureNonEmptyString(record.signature, `${label}.signature`);
  const signerId = ensureNonEmptyString(record.signerId, `${label}.signerId`);
  ensureNonEmptyString(record.minDesktopVersion, `${label}.minDesktopVersion`);
  ensureNonEmptyString(record.minHookApiVersion, `${label}.minHookApiVersion`);
  if (!Array.isArray(record.capabilities)) {
    throw new Error(`${label}.capabilities must be an array`);
  }
  if (typeof record.requiresReconsentOnCapabilityIncrease !== 'boolean') {
    throw new Error(`${label}.requiresReconsentOnCapabilityIncrease must be boolean`);
  }
  validateNimiAppOnlyFields(record, packageType, label);
  validatePublisher(record.publisher, `${label}.publisher`);
  const source = ensureObject(record.source, `${label}.source`);
  ensureNonEmptyString(source.repoUrl, `${label}.source.repoUrl`);
  ensureNonEmptyString(source.releaseTag, `${label}.source.releaseTag`);
  validateState(record.state, `${label}.state`);
  if (signerRegistry) {
    const signer = signerRegistry[signerId];
    if (!signer) {
      throw new Error(`${label}.signerId references unknown signer ${signerId}`);
    }
    validateSignerRecord(signerId, signer, `${label}.signer`);
  }
}

function validatePackageSummary(summary, label = 'package summary') {
  const record = ensureObject(summary, label);
  const packageType = ensureNonEmptyString(record.packageType, `${label}.packageType`);
  if (!SUPPORTED_PACKAGE_TYPES.has(packageType)) {
    throw new Error(`${label}.packageType must be one of ${Array.from(SUPPORTED_PACKAGE_TYPES).join(', ')}`);
  }
  ensureNonEmptyString(record.packageId, `${label}.packageId`);
  ensureNonEmptyString(record.name, `${label}.name`);
  ensureNonEmptyString(record.description, `${label}.description`);
  validatePublisher(record.publisher, `${label}.publisher`);
  validateState(record.state, `${label}.state`);
  if (record.latestVersion != null) ensureNonEmptyString(record.latestVersion, `${label}.latestVersion`);
  if (record.latestChannel != null) ensureNonEmptyString(record.latestChannel, `${label}.latestChannel`);
  normalizeStringArray(record.keywords);
  normalizeStringArray(record.tags);
}

function validatePackageRecord(packageRecord) {
  const record = ensureObject(packageRecord, 'package record');
  const packageId = ensureNonEmptyString(record.packageId, 'package record.packageId');
  const packageType = ensureNonEmptyString(record.packageType, 'package record.packageType');
  if (!SUPPORTED_PACKAGE_TYPES.has(packageType)) {
    throw new Error(`package record.packageType must be one of ${Array.from(SUPPORTED_PACKAGE_TYPES).join(', ')}`);
  }
  ensureNonEmptyString(record.name, 'package record.name');
  ensureNonEmptyString(record.description, 'package record.description');
  validatePublisher(record.publisher, 'package record.publisher');
  validateState(record.state, 'package record.state');
  const channels = ensureObject(record.channels, 'package record.channels');
  const signers = Array.isArray(record.signers) ? record.signers : [];
  const releases = Array.isArray(record.releases) ? record.releases : [];
  if (releases.length === 0) {
    throw new Error(`package ${packageId} must contain at least one release`);
  }
  const signerIds = new Set();
  for (const signer of signers) {
    const signerId = ensureNonEmptyString(signer?.signerId, `package ${packageId} signer.signerId`);
    validateSignerRecord(signerId, signer, `package ${packageId} signer ${signerId}`);
    signerIds.add(signerId);
  }
  const releaseVersions = new Set();
  for (const release of releases) {
    validateReleaseRecord(release, { label: `package ${packageId} release ${release?.version || '<unknown>'}` });
    if (release.packageId !== packageId) {
      throw new Error(`release ${release.version} packageId mismatch: expected ${packageId}`);
    }
    if (release.packageType !== packageType) {
      throw new Error(`release ${release.version} packageType mismatch: expected ${packageType}`);
    }
    if (!signerIds.has(release.signerId)) {
      throw new Error(`release ${release.version} signerId ${release.signerId} missing from package signers`);
    }
    releaseVersions.add(release.version);
  }
  for (const [channel, version] of Object.entries(channels)) {
    ensureNonEmptyString(channel, `package ${packageId} channel key`);
    const normalizedVersion = ensureNonEmptyString(version, `package ${packageId} channel ${channel}`);
    if (!releaseVersions.has(normalizedVersion)) {
      throw new Error(`package ${packageId} channel ${channel} points to missing release ${normalizedVersion}`);
    }
  }
}

function resolvePackageState(releases) {
  return releases.reduce((state, release) => ({
    listed: state.listed || Boolean(release.state?.listed),
    yanked: state.yanked || Boolean(release.state?.yanked),
    quarantined: state.quarantined || Boolean(release.state?.quarantined),
  }), {
    listed: false,
    yanked: false,
    quarantined: false,
  });
}

function resolveLatestChannel(channels) {
  if (channels.stable) return 'stable';
  const [firstChannel = ''] = Object.keys(channels).sort();
  return firstChannel || undefined;
}

function buildPackageSummary(packageRecord) {
  const latestChannel = resolveLatestChannel(packageRecord.channels);
  return {
    packageId: packageRecord.packageId,
    packageType: packageRecord.packageType,
    name: packageRecord.name,
    description: packageRecord.description,
    latestVersion: latestChannel ? packageRecord.channels[latestChannel] : undefined,
    latestChannel,
    publisher: packageRecord.publisher,
    state: packageRecord.state,
    keywords: packageRecord.keywords,
    tags: packageRecord.tags,
  };
}

function buildPackageMetadata({ modManifest, packageOverride, existingPackageRecord, releaseRecord }) {
  const resolvedManifest = modManifest && typeof modManifest === 'object' ? modManifest : {};
  const existing = existingPackageRecord && typeof existingPackageRecord === 'object' ? existingPackageRecord : {};
  const packageId = String(releaseRecord.packageId || existing.packageId || resolvedManifest.id || '').trim();
  return {
    packageId,
    packageType: String(releaseRecord.packageType || existing.packageType || 'desktop-mod').trim() || 'desktop-mod',
    name: String(packageOverride.name || resolvedManifest.name || existing.name || packageId).trim(),
    description: String(packageOverride.description || resolvedManifest.description || existing.description || packageId).trim(),
    keywords: normalizeStringArray(packageOverride.keywords || resolvedManifest.keywords || existing.keywords),
    tags: normalizeStringArray(packageOverride.tags || resolvedManifest.tags || existing.tags),
  };
}

function buildPackageRecord({
  modManifest,
  releaseRecords,
  signerRegistry,
  packageOverride,
  existingPackageRecord,
}) {
  const sortedReleases = sortReleaseRecords(releaseRecords);
  const latestRelease = sortedReleases[0] || releaseRecords[0] || {};
  const metadata = buildPackageMetadata({
    modManifest,
    packageOverride,
    existingPackageRecord,
    releaseRecord: latestRelease,
  });
  if (!metadata.name || !metadata.description) {
    throw new Error(`package ${metadata.packageId || '<unknown>'} requires manifest metadata to build catalog record`);
  }
  const channels = Object.fromEntries(releaseRecords.map((release) => [release.channel, release.version]));
  const signerIds = new Set(sortedReleases.map((release) => release.signerId));
  const signers = Array.from(signerIds).map((signerId) => {
    const signer = signerRegistry.signers[signerId];
    if (!signer || !signer.publicKey) {
      throw new Error(`Missing signer public key for signerId=${signerId}`);
    }
    return signer;
  });
  const packageRecord = {
    packageId: metadata.packageId,
    packageType: metadata.packageType,
    name: metadata.name,
    description: metadata.description,
    publisher: latestRelease.publisher,
    state: resolvePackageState(sortedReleases),
    channels,
    keywords: metadata.keywords,
    tags: metadata.tags,
    signers,
    releases: sortedReleases,
  };
  validatePackageRecord(packageRecord);
  return packageRecord;
}

function resolveCatalogIndexDir(catalogDir) {
  const root = path.resolve(catalogDir);
  if (fs.existsSync(path.join(root, 'packages.json'))) {
    return root;
  }
  return path.join(root, 'index', 'v1');
}

function loadCatalogShell(catalogDir) {
  const indexDir = resolveCatalogIndexDir(catalogDir);
  const packagesPath = path.join(indexDir, 'packages.json');
  const packages = fs.existsSync(packagesPath) ? readJson(packagesPath) : [];
  const revocationsPath = path.join(indexDir, 'revocations.json');
  const advisoriesPath = path.join(indexDir, 'advisories.json');
  return {
    indexDir,
    packages: Array.isArray(packages) ? packages : [],
    revocations: fs.existsSync(revocationsPath) ? readJson(revocationsPath) : { items: [] },
    advisories: fs.existsSync(advisoriesPath) ? readJson(advisoriesPath) : { items: [] },
  };
}

function readOptionalPackageRecord(indexDir, packageId) {
  const packagePath = path.join(indexDir, 'packages', `${packageId}.json`);
  if (!fs.existsSync(packagePath)) {
    return null;
  }
  return readJson(packagePath);
}

function cloneReleaseRecord(releaseRecord, expectedPackageId, expectedChannel) {
  if (expectedPackageId && expectedPackageId !== releaseRecord.packageId) {
    throw new Error(`release manifest packageId mismatch: expected ${expectedPackageId}, got ${releaseRecord.packageId}`);
  }
  if (expectedChannel && expectedChannel !== releaseRecord.channel) {
    throw new Error(`release manifest channel mismatch: expected ${expectedChannel}, got ${releaseRecord.channel}`);
  }
  return {
    ...releaseRecord,
    ...pickNimiAppOnlyFields(releaseRecord),
  };
}

function upsertPackageSummary(packageSummaries, packageRecord) {
  const summary = buildPackageSummary(packageRecord);
  const next = packageSummaries
    .filter((item) => item.packageId !== packageRecord.packageId)
    .concat(summary)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
  return next;
}

function mergeReleaseIntoPackageRecord({
  existingPackageRecord,
  releaseRecord,
  manifestFile,
  signerRegistry,
  packageOverride,
}) {
  const modManifest = manifestFile ? readYamlOrJson(manifestFile) : null;
  if (!existingPackageRecord && !modManifest) {
    throw new Error(`manifestFile is required when adding a new package: ${releaseRecord.packageId}`);
  }
  const existingReleases = existingPackageRecord?.releases || [];
  const mergedReleases = existingReleases
    .filter((item) => item.version !== releaseRecord.version)
    .concat(releaseRecord);
  const nextChannels = {
    ...(existingPackageRecord?.channels || {}),
    [releaseRecord.channel]: releaseRecord.version,
  };
  const rebuilt = buildPackageRecord({
    modManifest,
    releaseRecords: mergedReleases,
    signerRegistry,
    packageOverride,
    existingPackageRecord,
  });
  rebuilt.channels = nextChannels;
  rebuilt.releases = sortReleaseRecords(mergedReleases);
  rebuilt.state = resolvePackageState(rebuilt.releases);
  validatePackageRecord(rebuilt);
  return rebuilt;
}

export function loadSignerRegistry(filePath) {
  if (!filePath) {
    return {
      signers: {},
      packageOverrides: {},
    };
  }
  const parsed = readJson(filePath);
  const rawSigners = parsed.signers && typeof parsed.signers === 'object' ? parsed.signers : {};
  const rawPackageOverrides = parsed.packageOverrides && typeof parsed.packageOverrides === 'object'
    ? parsed.packageOverrides
    : {};
  return {
    signers: Object.fromEntries(
      Object.entries(rawSigners).map(([signerId, value]) => {
        const record = value && typeof value === 'object' ? value : {};
        return [signerId, {
          signerId,
          algorithm: String(record.algorithm || 'ed25519').trim() || 'ed25519',
          publicKey: String(record.publicKey || '').trim(),
        }];
      }),
    ),
    packageOverrides: rawPackageOverrides,
  };
}

export function validateSignerRegistryFile({ signersFile }) {
  const registry = loadSignerRegistry(signersFile);
  for (const [signerId, signer] of Object.entries(registry.signers)) {
    validateSignerRecord(signerId, signer, `signer registry ${signerId}`);
  }
  return {
    signerCount: Object.keys(registry.signers).length,
    packageOverrideCount: Object.keys(registry.packageOverrides).length,
  };
}

export function validateStaticModCatalog({ catalogDir }) {
  const indexDir = resolveCatalogIndexDir(catalogDir);
  const packagesPath = path.join(indexDir, 'packages.json');
  const packages = readJson(packagesPath);
  if (!Array.isArray(packages)) {
    throw new Error(`${packagesPath} must be an array`);
  }
  const seenPackageIds = new Set();
  for (const summary of packages) {
    validatePackageSummary(summary);
    if (seenPackageIds.has(summary.packageId)) {
      throw new Error(`packages.json contains duplicate packageId ${summary.packageId}`);
    }
    seenPackageIds.add(summary.packageId);
    const packagePath = path.join(indexDir, 'packages', `${summary.packageId}.json`);
    const packageRecord = readJson(packagePath);
    validatePackageRecord(packageRecord);
    if (packageRecord.packageId !== summary.packageId) {
      throw new Error(`package file ${packagePath} packageId mismatch`);
    }
    if (packageRecord.packageType !== summary.packageType) {
      throw new Error(`package file ${packagePath} packageType mismatch`);
    }
    for (const release of packageRecord.releases) {
      const releasePath = path.join(indexDir, 'releases', packageRecord.packageId, `${release.version}.json`);
      const storedRelease = readJson(releasePath);
      validateReleaseRecord(storedRelease, {
        signerRegistry: Object.fromEntries(packageRecord.signers.map((signer) => [signer.signerId, signer])),
        label: `stored release ${packageRecord.packageId}@${release.version}`,
      });
      if (storedRelease.packageId !== packageRecord.packageId || storedRelease.version !== release.version) {
        throw new Error(`release file ${releasePath} does not match package metadata`);
      }
    }
  }
  const revocations = readJson(path.join(indexDir, 'revocations.json'));
  if (!Array.isArray(revocations.items)) {
    throw new Error('revocations.json.items must be an array');
  }
  const advisories = readJson(path.join(indexDir, 'advisories.json'));
  if (!Array.isArray(advisories.items)) {
    throw new Error('advisories.json.items must be an array');
  }
  return {
    packageCount: packages.length,
    indexDir,
  };
}

export function updateModCatalog({
  catalogDir,
  releaseManifestPaths,
  manifestFile,
  signersFile,
  expectedPackageId,
  expectedChannel,
}) {
  const manifestPaths = (Array.isArray(releaseManifestPaths) ? releaseManifestPaths : [releaseManifestPaths])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  if (manifestPaths.length === 0) {
    throw new Error('releaseManifestPaths is required');
  }
  const registry = loadSignerRegistry(signersFile);
  validateSignerRegistryFile({ signersFile });
  const shell = loadCatalogShell(catalogDir);
  let packageSummaries = shell.packages.slice();
  for (const releaseManifestPath of manifestPaths) {
    const releaseRecord = cloneReleaseRecord(
      readJson(releaseManifestPath),
      expectedPackageId,
      expectedChannel,
    );
    validateReleaseRecord(releaseRecord, {
      signerRegistry: registry.signers,
      label: `release manifest ${path.basename(releaseManifestPath)}`,
    });
    const existingPackageRecord = readOptionalPackageRecord(shell.indexDir, releaseRecord.packageId);
    const packageOverride = registry.packageOverrides[String(releaseRecord.packageId || '')] || {};
    const packageRecord = mergeReleaseIntoPackageRecord({
      existingPackageRecord,
      releaseRecord,
      manifestFile,
      signerRegistry: registry,
      packageOverride,
    });
    writeJson(
      path.join(shell.indexDir, 'packages', `${packageRecord.packageId}.json`),
      packageRecord,
    );
    writeJson(
      path.join(shell.indexDir, 'releases', packageRecord.packageId, `${releaseRecord.version}.json`),
      releaseRecord,
    );
    packageSummaries = upsertPackageSummary(packageSummaries, packageRecord);
  }
  writeJson(path.join(shell.indexDir, 'packages.json'), packageSummaries);
  writeJson(path.join(shell.indexDir, 'revocations.json'), shell.revocations);
  writeJson(path.join(shell.indexDir, 'advisories.json'), shell.advisories);
  const validated = validateStaticModCatalog({ catalogDir });
  return {
    packageCount: validated.packageCount,
    packageIds: packageSummaries.map((item) => item.packageId),
    indexDir: shell.indexDir,
  };
}

export function generateModCatalog({ sourceDir, outDir, signersFile }) {
  const registry = loadSignerRegistry(signersFile);
  validateSignerRegistryFile({ signersFile });
  const packageRecords = [];
  const packageSummaries = [];
  const sourceEntries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const entryName of sourceEntries) {
    const modDir = path.join(sourceDir, entryName);
    const manifestPath = findManifestFile(modDir);
    const releasePath = path.join(modDir, 'dist', 'packages', 'release.manifest.json');
    if (!manifestPath || !fs.existsSync(releasePath)) {
      continue;
    }
    const modManifest = readYamlOrJson(manifestPath);
    const releaseRecord = readJson(releasePath);
    validateReleaseRecord(releaseRecord, {
      signerRegistry: registry.signers,
      label: `release manifest ${entryName}`,
    });
    const packageOverride = registry.packageOverrides[String(releaseRecord.packageId || '')] || {};
    const packageRecord = buildPackageRecord({
      modManifest,
      releaseRecords: [releaseRecord],
      signerRegistry: registry,
      packageOverride,
      existingPackageRecord: null,
    });
    packageRecords.push(packageRecord);
    packageSummaries.push(buildPackageSummary(packageRecord));
  }

  writeJson(path.join(outDir, 'index/v1/packages.json'), packageSummaries.sort((left, right) => left.packageId.localeCompare(right.packageId)));
  for (const packageRecord of packageRecords) {
    writeJson(
      path.join(outDir, 'index/v1/packages', `${packageRecord.packageId}.json`),
      packageRecord,
    );
    for (const release of packageRecord.releases) {
      writeJson(
        path.join(outDir, 'index/v1/releases', packageRecord.packageId, `${release.version}.json`),
        release,
      );
    }
  }
  writeJson(path.join(outDir, 'index/v1/revocations.json'), { items: [] });
  writeJson(path.join(outDir, 'index/v1/advisories.json'), { items: [] });
  validateStaticModCatalog({ catalogDir: outDir });

  return {
    packageCount: packageRecords.length,
    outputDir: outDir,
    packageIds: packageRecords.map((item) => item.packageId),
  };
}
