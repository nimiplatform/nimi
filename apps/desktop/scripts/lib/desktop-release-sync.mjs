import fs from 'node:fs';
import path from 'node:path';

const DESKTOP_RELEASE_FIELDS = [
  'builtAt',
  'channel',
  'commit',
  'desktopReleaseId',
  'desktopVersion',
];

const FORBIDDEN_RUNTIME_RELEASE_FIELDS = [
  'runtimeArchivePath',
  'runtimeBinaryPath',
  'runtimeReady',
  'runtimeSha256',
  'runtimeStagedPath',
  'runtimeVersion',
];

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readCargoVersion(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) throw new Error(`unable to read version from ${filePath}`);
  return String(match[1] || '').trim();
}

function normalizeValue(value) {
  return String(value || '').trim();
}

function validReleaseText(value) {
  const normalized = normalizeValue(value);
  return normalized.length > 0
    && normalized.length <= 128
    && /^[\x21-\x7e]+$/.test(normalized)
    && !/[\\/]/.test(normalized);
}

function listRuntimePayloads(root) {
  if (!fs.existsSync(root)) return [];
  const payloads = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (!['.gitignore', '.gitkeep'].includes(entry.name)) payloads.push(absolute);
    }
  };
  visit(root);
  return payloads.sort((left, right) => left.localeCompare(right));
}

export function collectStaticVersionSyncViolations(desktopRoot, expectedInput) {
  const tauriRoot = path.join(desktopRoot, 'src-tauri');
  const desktopPackage = readJson(path.join(desktopRoot, 'package.json'));
  const expected = normalizeValue(expectedInput || desktopPackage.version);
  if (!expected) throw new Error('expected version is empty');
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
  const manifestPath = path.join(resourcesRoot, 'desktop-release-manifest.json');
  const desktopPackage = readJson(path.join(desktopRoot, 'package.json'));
  const expected = normalizeValue(expectedInput || desktopPackage.version);
  if (!expected) throw new Error('expected version is empty');

  const manifest = readJson(manifestPath);
  const tauriConfig = readJson(path.join(tauriRoot, 'tauri.conf.json'));
  const violations = [];
  const keys = Object.keys(manifest).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(keys) !== JSON.stringify(DESKTOP_RELEASE_FIELDS)) {
    violations.push(`desktop release manifest fields must be exactly: ${DESKTOP_RELEASE_FIELDS.join(', ')}`);
  }
  for (const field of FORBIDDEN_RUNTIME_RELEASE_FIELDS) {
    if (Object.hasOwn(manifest, field)) violations.push(`desktop release manifest contains forbidden ${field}`);
  }
  if (normalizeValue(manifest.desktopVersion) !== expected) {
    violations.push(`desktop release version mismatch: expected ${expected}, got ${manifest.desktopVersion}`);
  }
  for (const field of ['desktopReleaseId', 'channel', 'commit']) {
    if (!validReleaseText(manifest[field])) violations.push(`desktop release ${field} is invalid`);
  }
  if (!normalizeValue(manifest.builtAt) || !Number.isFinite(Date.parse(manifest.builtAt))) {
    violations.push('desktop release builtAt must be a valid timestamp');
  }

  const bundleResources = Array.isArray(tauriConfig?.bundle?.resources)
    ? tauriConfig.bundle.resources.map(normalizeValue)
    : [];
  if (!bundleResources.includes('resources/desktop-release-manifest.json')) {
    violations.push('Tauri bundle is missing the Desktop release manifest resource');
  }
  if (bundleResources.some((entry) => entry === 'resources/runtime' || entry.startsWith('resources/runtime/'))) {
    violations.push('Tauri bundle must not contain Runtime resources');
  }
  for (const payload of listRuntimePayloads(path.join(resourcesRoot, 'runtime'))) {
    violations.push(`forbidden bundled Runtime payload: ${path.relative(desktopRoot, payload)}`);
  }
  return violations;
}
