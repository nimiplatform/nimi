import fs from 'node:fs';
import path from 'node:path';

const SUPPORTED_PACKAGE_TYPES = new Set(['desktop-mod', 'nimi-app']);
const NIMI_APP_ONLY_FIELDS = ['appMode', 'scopeCatalogVersion', 'minRuntimeVersion'];

function parseArgs(argv) {
  const args = {
    signersFile: path.resolve('signers.example.json'),
    catalogDir: path.resolve('.'),
    skipSigners: false,
    skipCatalog: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--signers-file') {
      args.signersFile = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--catalog-dir') {
      args.catalogDir = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--skip-signers') {
      args.skipSigners = true;
      continue;
    }
    if (arg === '--skip-catalog') {
      args.skipCatalog = true;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
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

function validateReleaseRecord(release, label, knownSigners) {
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
  for (const field of NIMI_APP_ONLY_FIELDS) {
    const value = normalizeOptionalString(record[field]);
    if (!value) continue;
    if (packageType !== 'nimi-app') {
      throw new Error(`${label}.${field} is only allowed for packageType=nimi-app`);
    }
  }
  validatePublisher(record.publisher, `${label}.publisher`);
  const source = ensureObject(record.source, `${label}.source`);
  ensureNonEmptyString(source.repoUrl, `${label}.source.repoUrl`);
  ensureNonEmptyString(source.releaseTag, `${label}.source.releaseTag`);
  validateState(record.state, `${label}.state`);
  if (knownSigners && !knownSigners.has(signerId)) {
    throw new Error(`${label}.signerId references unknown signer ${signerId}`);
  }
}

function validatePackageRecord(packageRecord, packagesDir, releasesDir) {
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
    throw new Error(`package ${packageId} must include at least one release`);
  }
  const knownSigners = new Set();
  for (const signer of signers) {
    const signerId = ensureNonEmptyString(signer?.signerId, `package ${packageId} signer.signerId`);
    validateSignerRecord(signerId, signer, `package ${packageId} signer ${signerId}`);
    knownSigners.add(signerId);
  }
  const releaseVersions = new Set();
  for (const release of releases) {
    validateReleaseRecord(release, `package ${packageId} release ${release?.version || '<unknown>'}`, knownSigners);
    if (release.packageId !== packageId) {
      throw new Error(`release ${release.version} packageId mismatch in ${packagesDir}`);
    }
    if (release.packageType !== packageType) {
      throw new Error(`release ${release.version} packageType mismatch in ${packagesDir}`);
    }
    const releaseFilePath = path.join(releasesDir, packageId, `${release.version}.json`);
    if (!fs.existsSync(releaseFilePath)) {
      throw new Error(`missing release file ${releaseFilePath}`);
    }
    const storedRelease = readJson(releaseFilePath);
    validateReleaseRecord(storedRelease, `stored release ${packageId}@${release.version}`, knownSigners);
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

function validateSignerRegistry(signersFile) {
  const parsed = readJson(signersFile);
  const signers = parsed.signers && typeof parsed.signers === 'object' ? parsed.signers : {};
  const packageOverrides = parsed.packageOverrides && typeof parsed.packageOverrides === 'object'
    ? parsed.packageOverrides
    : {};
  for (const [signerId, signer] of Object.entries(signers)) {
    validateSignerRecord(signerId, signer, `signer registry ${signerId}`);
  }
  return {
    signerCount: Object.keys(signers).length,
    packageOverrideCount: Object.keys(packageOverrides).length,
  };
}

function validateCatalog(catalogDir) {
  const indexDir = path.join(catalogDir, 'index', 'v1');
  const packagesPath = path.join(indexDir, 'packages.json');
  const packagesDir = path.join(indexDir, 'packages');
  const releasesDir = path.join(indexDir, 'releases');
  const packages = readJson(packagesPath);
  if (!Array.isArray(packages)) {
    throw new Error(`${packagesPath} must be an array`);
  }
  const seen = new Set();
  for (const summary of packages) {
    const label = `package summary ${summary?.packageId || '<unknown>'}`;
    const packageType = ensureNonEmptyString(summary.packageType, `${label}.packageType`);
    if (!SUPPORTED_PACKAGE_TYPES.has(packageType)) {
      throw new Error(`${label}.packageType must be one of ${Array.from(SUPPORTED_PACKAGE_TYPES).join(', ')}`);
    }
    const packageId = ensureNonEmptyString(summary.packageId, `${label}.packageId`);
    ensureNonEmptyString(summary.name, `${label}.name`);
    ensureNonEmptyString(summary.description, `${label}.description`);
    validatePublisher(summary.publisher, `${label}.publisher`);
    validateState(summary.state, `${label}.state`);
    if (seen.has(packageId)) {
      throw new Error(`duplicate packageId in packages.json: ${packageId}`);
    }
    seen.add(packageId);
    const packagePath = path.join(packagesDir, `${packageId}.json`);
    if (!fs.existsSync(packagePath)) {
      throw new Error(`missing package file ${packagePath}`);
    }
    validatePackageRecord(readJson(packagePath), packagesDir, releasesDir);
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
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const signerResult = args.skipSigners ? { signerCount: 0, packageOverrideCount: 0 } : validateSignerRegistry(args.signersFile);
  const catalogResult = args.skipCatalog ? { packageCount: 0 } : validateCatalog(args.catalogDir);
  console.log(
    `catalog-template: ok signers=${signerResult.signerCount} overrides=${signerResult.packageOverrideCount} packages=${catalogResult.packageCount}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  console.error(`catalog-template: failed: ${message}`);
  process.exit(1);
}
