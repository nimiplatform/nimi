import fs from 'node:fs';
import path from 'node:path';

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readCargoVersion(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) {
    throw new Error(`unable to read version from ${filePath}`);
  }
  return String(match[1] || '').trim();
}

function normalizeValue(value) {
  return String(value || '').trim();
}

function isDirectory(entryPath) {
  return fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory();
}

function listPlatformRuntimeManifests(runtimeResourcesRoot) {
  if (!fs.existsSync(runtimeResourcesRoot)) {
    return [];
  }
  return fs.readdirSync(runtimeResourcesRoot)
    .map((name) => path.join(runtimeResourcesRoot, name))
    .filter((entryPath) => isDirectory(entryPath))
    .map((entryPath) => path.join(entryPath, 'manifest.json'))
    .filter((entryPath) => fs.existsSync(entryPath))
    .sort((left, right) => left.localeCompare(right));
}

export function collectStaticVersionSyncViolations(desktopRoot, expectedInput) {
  const tauriRoot = path.join(desktopRoot, 'src-tauri');
  const desktopPackage = readJson(path.join(desktopRoot, 'package.json'));
  const expected = normalizeValue(expectedInput || desktopPackage.version);
  if (!expected) {
    throw new Error('expected version is empty');
  }

  const tauriConfig = readJson(path.join(tauriRoot, 'tauri.conf.json'));
  const cargoVersion = readCargoVersion(path.join(tauriRoot, 'Cargo.toml'));
  const checks = [
    ['apps/desktop/package.json', desktopPackage.version],
    ['apps/desktop/src-tauri/tauri.conf.json', tauriConfig.version],
    ['apps/desktop/src-tauri/Cargo.toml', cargoVersion],
  ];

  return checks.flatMap(([label, actual]) => (
    normalizeValue(actual) === expected
      ? []
      : [`${label} mismatch: expected ${expected}, got ${actual}`]
  ));
}

export function collectDesktopReleaseSyncViolations(desktopRoot, expectedInput) {
  const tauriRoot = path.join(desktopRoot, 'src-tauri');
  const resourcesRoot = path.join(tauriRoot, 'resources');
  const runtimeResourcesRoot = path.join(resourcesRoot, 'runtime');
  const desktopPackage = readJson(path.join(desktopRoot, 'package.json'));
  const expected = normalizeValue(expectedInput || desktopPackage.version);
  if (!expected) {
    throw new Error('expected version is empty');
  }

  const releaseManifestPath = path.join(resourcesRoot, 'desktop-release-manifest.json');
  const runtimeManifestPath = path.join(runtimeResourcesRoot, 'manifest.json');
  const releaseManifest = readJson(releaseManifestPath);
  const runtimeManifest = readJson(runtimeManifestPath);
  const platformManifestPaths = listPlatformRuntimeManifests(runtimeResourcesRoot);
  const violations = [];

  const topLevelChecks = [
    ['apps/desktop/src-tauri/resources/desktop-release-manifest.json desktopVersion', releaseManifest.desktopVersion],
    ['apps/desktop/src-tauri/resources/desktop-release-manifest.json runtimeVersion', releaseManifest.runtimeVersion],
    ['apps/desktop/src-tauri/resources/runtime/manifest.json version', runtimeManifest.version],
  ];

  for (const [label, actual] of topLevelChecks) {
    if (normalizeValue(actual) !== expected) {
      violations.push(`${label} mismatch: expected ${expected}, got ${actual}`);
    }
  }

  if (normalizeValue(releaseManifest.runtimeArchivePath) !== normalizeValue(runtimeManifest.archivePath)) {
    violations.push(
      `runtime archive path mismatch: release=${releaseManifest.runtimeArchivePath} runtime=${runtimeManifest.archivePath}`,
    );
  }
  if (normalizeValue(releaseManifest.runtimeSha256) !== normalizeValue(runtimeManifest.sha256)) {
    violations.push(
      `runtime sha256 mismatch: release=${releaseManifest.runtimeSha256} runtime=${runtimeManifest.sha256}`,
    );
  }
  if (normalizeValue(releaseManifest.runtimeBinaryPath) !== normalizeValue(runtimeManifest.binaryPath)) {
    violations.push(
      `runtime binary path mismatch: release=${releaseManifest.runtimeBinaryPath} runtime=${runtimeManifest.binaryPath}`,
    );
  }

  const runtimeArchivePath = path.join(resourcesRoot, normalizeValue(releaseManifest.runtimeArchivePath));
  if (!fs.existsSync(runtimeArchivePath)) {
    violations.push(`runtime archive missing: ${path.relative(desktopRoot, runtimeArchivePath)}`);
  }

  if (platformManifestPaths.length === 0) {
    violations.push('no platform runtime manifests found under apps/desktop/src-tauri/resources/runtime');
  }

  for (const manifestPath of platformManifestPaths) {
    const platformManifest = readJson(manifestPath);
    const label = path.relative(desktopRoot, manifestPath);
    if (normalizeValue(platformManifest.version) !== expected) {
      violations.push(`${label} version mismatch: expected ${expected}, got ${platformManifest.version}`);
    }
    if (normalizeValue(platformManifest.archivePath) !== normalizeValue(runtimeManifest.archivePath)) {
      violations.push(
        `${label} archivePath mismatch: expected ${runtimeManifest.archivePath}, got ${platformManifest.archivePath}`,
      );
    }
    if (normalizeValue(platformManifest.sha256) !== normalizeValue(runtimeManifest.sha256)) {
      violations.push(
        `${label} sha256 mismatch: expected ${runtimeManifest.sha256}, got ${platformManifest.sha256}`,
      );
    }
    if (normalizeValue(platformManifest.binaryPath) !== normalizeValue(runtimeManifest.binaryPath)) {
      violations.push(
        `${label} binaryPath mismatch: expected ${runtimeManifest.binaryPath}, got ${platformManifest.binaryPath}`,
      );
    }
  }

  return violations;
}
