#!/usr/bin/env node

/**
 * SDK version check — independently published package mode.
 */

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SDK_PACKAGE_PATH = 'sdks/typescript';

const SDK_PACKAGES = [
  { id: 'sdk', path: SDK_PACKAGE_PATH },
  { id: 'kit', path: 'kit' },
  { id: 'app-tools', path: 'app-tools' },
];
const KIT_NATIVE_PACKAGES = [
  {
    name: '@nimiplatform/kit-protected-local-darwin-arm64',
    path: 'kit/shell/protected-local-node/npm/darwin-arm64',
  },
  {
    name: '@nimiplatform/kit-protected-local-win32-x64',
    path: 'kit/shell/protected-local-node/npm/win32-x64',
  },
];
const RUNTIME_NPM_PACKAGES = [
  { name: '@nimiplatform/nimi-darwin-arm64', path: 'npm-packages/nimi-darwin-arm64' },
  { name: '@nimiplatform/nimi-darwin-x64', path: 'npm-packages/nimi-darwin-x64' },
  { name: '@nimiplatform/nimi-linux-arm64', path: 'npm-packages/nimi-linux-arm64' },
  { name: '@nimiplatform/nimi-linux-x64', path: 'npm-packages/nimi-linux-x64' },
  { name: '@nimiplatform/nimi-win32-arm64', path: 'npm-packages/nimi-win32-arm64' },
  { name: '@nimiplatform/nimi-win32-x64', path: 'npm-packages/nimi-win32-x64' },
];
const SHELL_CRATES = [
  { name: 'nimi-shell-protected-local', path: 'kit/shell/protected-local/Cargo.toml' },
  { name: 'nimi-shell-protected-local-node', path: 'kit/shell/protected-local-node/Cargo.toml' },
];
const PUBLIC_REPOSITORY_URL = 'https://github.com/nimiplatform/nimi';

export function resolvePublicRuntimeSurfacePaths(sdkExports, sdkPackagePath = SDK_PACKAGE_PATH) {
  if (!sdkExports || typeof sdkExports !== 'object') {
    return [];
  }
  const paths = new Set();
  for (const [subpath, target] of Object.entries(sdkExports)) {
    if (
      subpath !== './runtime'
      && !subpath.startsWith('./runtime/')
      && subpath !== './types'
      && !subpath.startsWith('./types/')
    ) {
      continue;
    }
    const rawTarget = typeof target === 'string'
      ? target
      : (target?.types || target?.import || target?.default || '');
    const normalized = String(rawTarget || '').trim().replaceAll('\\', '/');
    const distMatch = normalized.match(/^\.\/dist\/(.+?)(?:\.d\.ts|\.js)$/u);
    if (!distMatch) {
      continue;
    }
    paths.add(path.posix.join(sdkPackagePath, `${distMatch[1]}.ts`));
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function parseSemver(version) {
  const match = String(version || '').trim().match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u,
  );
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    return String(leftVersion || '').localeCompare(String(rightVersion || ''));
  }
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) {
      return left[field] - right[field];
    }
  }
  const leftPre = left.prerelease;
  const rightPre = right.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;
  const maxLen = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < maxLen; index += 1) {
    if (index >= leftPre.length) return -1;
    if (index >= rightPre.length) return 1;
    const a = leftPre[index];
    const b = rightPre[index];
    if (a === b) continue;
    const aNum = /^\d+$/u.test(a);
    const bNum = /^\d+$/u.test(b);
    if (aNum && bNum) return Number(a) - Number(b);
    if (aNum) return -1;
    if (bNum) return 1;
    return a.localeCompare(b);
  }
  return 0;
}

export function selectLatestPublishedSdkRef(
  tagEntries,
  { override = '', headCommit = '', hasWorktreeSurfaceChanges = false } = {},
) {
  const normalizedOverride = String(override || '').trim();
  if (normalizedOverride) {
    return normalizedOverride;
  }
  const normalizedHead = String(headCommit || '').trim();
  const candidates = [];
  for (const entry of tagEntries || []) {
    const ref = typeof entry === 'string' ? entry.trim() : String(entry?.ref || '').trim();
    const commit = typeof entry === 'string' ? '' : String(entry?.commit || '').trim();
    const match = ref.match(/^sdk\/v(.+)$/u);
    if (!match || !parseSemver(match[1])) {
      continue;
    }
    if (!hasWorktreeSurfaceChanges && normalizedHead && commit === normalizedHead) {
      continue;
    }
    candidates.push({ ref, version: match[1] });
  }
  candidates.sort((left, right) => compareSemver(right.version, left.version));
  return candidates[0]?.ref || '';
}

export function isRuntimeSurfaceVersionAdvanced(baseVersion, currentVersion) {
  const base = parseSemver(baseVersion);
  const current = parseSemver(currentVersion);
  if (!base || !current) {
    return false;
  }
  if (compareSemver(currentVersion, baseVersion) <= 0) {
    return false;
  }
  if (base.prerelease.length > 0) {
    return true;
  }
  return parseMajorMinor(baseVersion) !== parseMajorMinor(currentVersion);
}

function runGit(args) {
  const result = spawnSync(
    'git',
    args,
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function listGitPaths(args, gitRunner = runGit) {
  const result = gitRunner(args);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
}

function parseMajorMinor(version) {
  return String(version || '').trim().split('.').slice(0, 2).join('.');
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function readCargoPackage(relativePath) {
  const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
  const lines = source.split(/\r?\n/u);
  const packageStart = lines.findIndex((line) => line.trim() === '[package]');
  const packageEnd = lines.findIndex((line, index) => index > packageStart && /^\s*\[/u.test(line));
  const packageBlock = packageStart >= 0
    ? lines.slice(packageStart + 1, packageEnd >= 0 ? packageEnd : undefined).join('\n')
    : '';
  const name = packageBlock.match(/^name\s*=\s*"([^"]+)"\s*$/mu)?.[1] || '';
  const version = packageBlock.match(/^version\s*=\s*"([^"]+)"\s*$/mu)?.[1] || '';
  return { name, path: relativePath, source, version };
}

function readInlineCargoDependencyVersion(source, dependencyName) {
  const escaped = dependencyName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return source.match(new RegExp(`^${escaped}\\s*=\\s*\\{[^}\\n]*\\bversion\\s*=\\s*"([^"]+)"`, 'mu'))?.[1] || '';
}

function checkPublicPackageMetadata(violations, manifest, label, repositoryDirectory, license) {
  if (manifest.license !== license) violations.push(`${label} license must be ${license}`);
  if (manifest.repository?.type !== 'git' || manifest.repository?.url !== PUBLIC_REPOSITORY_URL) {
    violations.push(`${label} repository must be ${PUBLIC_REPOSITORY_URL}`);
  }
  if (manifest.repository?.directory !== repositoryDirectory) {
    violations.push(`${label} repository.directory must be ${repositoryDirectory}`);
  }
  if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.provenance !== true) {
    violations.push(`${label} publishConfig must enable public access and provenance`);
  }
}

function readPackageVersionFromGit(ref, gitRunner = runGit) {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) {
    return '';
  }
  const result = gitRunner(['show', `${normalizedRef}:${SDK_PACKAGE_PATH}/package.json`]);
  if (result.status !== 0) {
    return '';
  }
  try {
    return String(JSON.parse(result.stdout).version || '').trim();
  } catch {
    return '';
  }
}

function listMergedSdkTagEntries(gitRunner = runGit) {
  const result = gitRunner([
    'for-each-ref',
    '--merged',
    'HEAD',
    '--format=%(refname:short)\t%(*objectname)\t%(objectname)',
    'refs/tags/sdk/v*',
  ]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref = '', peeled = '', objectName = ''] = line.split('\t');
      return { ref: ref.trim(), commit: (peeled || objectName).trim() };
    });
}

function latestPublishedSdkRef({
  hasWorktreeSurfaceChanges = false,
  override = process.env.NIMI_PUBLISHED_SDK_REF,
  gitRunner = runGit,
} = {}) {
  const normalizedOverride = String(override || '').trim();
  if (normalizedOverride) return normalizedOverride;
  const headResult = gitRunner(['rev-parse', 'HEAD']);
  const headCommit = headResult.status === 0 ? headResult.stdout.trim() : '';
  return selectLatestPublishedSdkRef(listMergedSdkTagEntries(gitRunner), {
    override: normalizedOverride,
    headCommit,
    hasWorktreeSurfaceChanges,
  });
}

export function detectRuntimeSurfaceVersionContext(
  currentVersion,
  surfacePaths,
  { gitRunner = runGit, overrideRef = process.env.NIMI_PUBLISHED_SDK_REF } = {},
) {
  if (!Array.isArray(surfacePaths) || surfacePaths.length === 0) return null;
  const worktreePaths = listGitPaths(['diff', '--name-only', 'HEAD', '--', ...surfacePaths], gitRunner);
  const baseRef = latestPublishedSdkRef({
    hasWorktreeSurfaceChanges: worktreePaths.length > 0,
    override: overrideRef,
    gitRunner,
  });
  if (!baseRef) return null;
  const committedPaths = listGitPaths(['diff', '--name-only', `${baseRef}...HEAD`, '--', ...surfacePaths], gitRunner);
  const changedSurfacePaths = [...new Set([...committedPaths, ...worktreePaths])];
  if (changedSurfacePaths.length === 0) return null;
  const baseVersion = readPackageVersionFromGit(baseRef, gitRunner);
  if (!baseVersion) return null;
  return {
    baseRef,
    changedSurfacePaths,
    baseVersion,
    currentVersion,
    comparisonLabel: `${baseRef} -> current candidate`,
  };
}

async function main() {
  const violations = [];
  const packageVersions = new Map();

  // Read all package.json files
  for (const pkg of SDK_PACKAGES) {
    const pkgJsonPath = path.join(repoRoot, pkg.path, 'package.json');
    let raw;
    try {
      raw = await fs.readFile(pkgJsonPath, 'utf8');
    } catch {
      violations.push(`missing package.json: ${pkg.path}/package.json`);
      continue;
    }
    const parsed = JSON.parse(raw);
    packageVersions.set(parsed.name, { version: parsed.version, path: pkg.path, pkg: parsed });
  }

  // Check cross-references point to workspace protocol
  for (const [name, { pkg: parsed, path: pkgPath }] of packageVersions) {
    const allDeps = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
      ...parsed.peerDependencies,
    };
    for (const [depName, depVersion] of Object.entries(allDeps)) {
      if (!packageVersions.has(depName)) continue;
      // In a pnpm workspace, internal deps should use workspace:* protocol
      if (!String(depVersion).startsWith('workspace:')) {
        violations.push(
          `${name} references ${depName} as "${depVersion}" — expected workspace:* protocol`
        );
      }
    }
  }

  // Check required fields
  for (const [name, { pkg: parsed, path: pkgPath }] of packageVersions) {
    if (!parsed.version) {
      violations.push(`${name} (${pkgPath}) missing "version" field`);
    }
    if (!parsed.license) {
      violations.push(`${name} (${pkgPath}) missing "license" field`);
    }
    if (!parsed.exports && !parsed.main && !parsed.bin) {
      violations.push(`${name} (${pkgPath}) missing "exports", "main", or "bin" field`);
    }
    checkPublicPackageMetadata(
      violations,
      parsed,
      name,
      pkgPath,
      name === '@nimiplatform/kit' ? 'MIT' : 'Apache-2.0',
    );
  }

  const sdkPackage = packageVersions.get('@nimiplatform/sdk');
  const sdkVersion = sdkPackage?.version || '';
  const kitVersion = packageVersions.get('@nimiplatform/kit')?.version || '';
  const appToolsVersion = packageVersions.get('@nimiplatform/app-tools')?.version || '';
  const expectedSdkRange = sdkVersion ? `^${sdkVersion}` : '';
  const expectedKitRange = kitVersion ? `^${kitVersion}` : '';
  const expectedAppToolsRange = appToolsVersion ? `^${appToolsVersion}` : '';

  const adapterPath = 'sdks/typescript/adapters/vercel-ai';
  const adapter = await readJson(`${adapterPath}/package.json`);
  if (adapter.name !== '@nimiplatform/sdk-adapter-vercel-ai' || adapter.private !== false || !adapter.version) {
    violations.push('Vercel adapter must have its own publishable package identity');
  }
  checkPublicPackageMetadata(violations, adapter, adapter.name, adapterPath, 'Apache-2.0');
  if (adapter.peerDependencies?.['@nimiplatform/sdk'] !== expectedSdkRange) {
    violations.push(`Vercel adapter SDK peer must be ${expectedSdkRange}`);
  }

  const kitPackage = packageVersions.get('@nimiplatform/kit')?.pkg;
  for (const native of KIT_NATIVE_PACKAGES) {
    let manifest;
    try {
      manifest = await readJson(`${native.path}/package.json`);
    } catch (error) {
      violations.push(`${native.path}/package.json: failed to read (${String(error)})`);
      continue;
    }
    if (manifest.name !== native.name) {
      violations.push(`${native.path}/package.json name must be "${native.name}"`);
    }
    if (manifest.version !== kitVersion) {
      violations.push(`${native.name} version ${manifest.version || '<missing>'} must match @nimiplatform/kit ${kitVersion}`);
    }
    if (manifest.private === true) {
      violations.push(`${native.name} must remain publishable`);
    }
    checkPublicPackageMetadata(
      violations,
      manifest,
      native.name,
      'kit/shell/protected-local-node',
      'MIT',
    );
    const dependencyVersion = kitPackage?.optionalDependencies?.[native.name];
    if (dependencyVersion !== 'workspace:*') {
      violations.push(`@nimiplatform/kit optional dependency ${native.name} must be workspace:*`);
    }
  }

  let runtimeLauncher;
  try {
    runtimeLauncher = await readJson('npm-packages/nimi/package.json');
  } catch (error) {
    violations.push(`npm-packages/nimi/package.json: failed to read (${String(error)})`);
  }
  const runtimeVersion = String(runtimeLauncher?.version || '').trim();
  if (!runtimeVersion) {
    violations.push('@nimiplatform/nimi runtime launcher is missing version');
  }
  if (runtimeLauncher) {
    checkPublicPackageMetadata(
      violations,
      runtimeLauncher,
      '@nimiplatform/nimi',
      'npm-packages/nimi',
      'Apache-2.0',
    );
  }
  for (const platform of RUNTIME_NPM_PACKAGES) {
    let manifest;
    try {
      manifest = await readJson(`${platform.path}/package.json`);
    } catch (error) {
      violations.push(`${platform.path}/package.json: failed to read (${String(error)})`);
      continue;
    }
    if (manifest.name !== platform.name) {
      violations.push(`${platform.path}/package.json name must be "${platform.name}"`);
    }
    if (manifest.version !== runtimeVersion) {
      violations.push(`${platform.name} version ${manifest.version || '<missing>'} must match @nimiplatform/nimi ${runtimeVersion}`);
    }
    if (manifest.private === true) {
      violations.push(`${platform.name} must remain publishable`);
    }
    checkPublicPackageMetadata(
      violations,
      manifest,
      platform.name,
      platform.path,
      'Apache-2.0',
    );
    const dependencyVersion = runtimeLauncher?.optionalDependencies?.[platform.name];
    if (dependencyVersion !== runtimeVersion) {
      violations.push(`@nimiplatform/nimi optional dependency ${platform.name} must be exact version ${runtimeVersion}`);
    }
  }

  const shellCrates = [];
  for (const crate of SHELL_CRATES) {
    try {
      const parsed = await readCargoPackage(crate.path);
      shellCrates.push(parsed);
      if (parsed.name !== crate.name) {
        violations.push(`${crate.path} package name must be "${crate.name}"`);
      }
      if (!parsed.version) {
        violations.push(`${crate.path} is missing package version`);
      }
    } catch (error) {
      violations.push(`${crate.path}: failed to read (${String(error)})`);
    }
  }
  const shellCratesByName = new Map(shellCrates.map((crate) => [crate.name, crate]));
  const protectedLocalVersion = shellCratesByName.get('nimi-shell-protected-local')?.version || '';
  const protectedLocalNode = shellCratesByName.get('nimi-shell-protected-local-node');
  if (protectedLocalNode && protectedLocalNode.version !== protectedLocalVersion) {
    violations.push(
      `${protectedLocalNode.name} version ${protectedLocalNode.version || '<missing>'} `
      + `must match nimi-shell-protected-local ${protectedLocalVersion}`,
    );
  }
  for (const crate of shellCrates.filter((item) => item.name !== 'nimi-shell-protected-local')) {
    const dependencyVersion = readInlineCargoDependencyVersion(crate.source, 'nimi-shell-protected-local');
    if (dependencyVersion !== protectedLocalVersion) {
      violations.push(
        `${crate.name} dependency nimi-shell-protected-local must be exact version ${protectedLocalVersion}`,
      );
    }
  }

  const scaffoldVersions = packageVersions.get('@nimiplatform/app-tools')?.pkg?.nimiScaffoldVersions;
  for (const field of ['sdkVersion', 'kitVersion']) {
    // A selected local RC is a complete versioned package, not a publication claim.
    if (!/^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/u.test(scaffoldVersions?.[field] ?? '')) {
      violations.push(`app-tools/package.json nimiScaffoldVersions.${field} must be a stable or numbered RC package range`);
    }
  }
  if (scaffoldVersions?.appToolsVersion !== expectedAppToolsRange) {
    violations.push(`app-tools/package.json nimiScaffoldVersions.appToolsVersion must be "${expectedAppToolsRange}"`);
  }
  if (sdkPackage?.version) {
    const publicRuntimeSurfacePaths = resolvePublicRuntimeSurfacePaths(sdkPackage.pkg?.exports);
    if (publicRuntimeSurfacePaths.length === 0) {
      violations.push('@nimiplatform/sdk exports must declare public runtime/type surface paths');
    }
    for (const surfacePath of publicRuntimeSurfacePaths) {
      try {
        await fs.access(path.join(repoRoot, surfacePath));
      } catch {
        violations.push(`@nimiplatform/sdk exported runtime/type surface file missing: ${surfacePath}`);
      }
    }
    const runtimeSurfaceContext = detectRuntimeSurfaceVersionContext(
      sdkPackage.version,
      publicRuntimeSurfacePaths,
    );
    const versionNotAdvanced = runtimeSurfaceContext
      && !isRuntimeSurfaceVersionAdvanced(
        runtimeSurfaceContext.baseVersion,
        runtimeSurfaceContext.currentVersion,
      );
    if (runtimeSurfaceContext && versionNotAdvanced) {
      violations.push(
        `@nimiplatform/sdk public runtime surface changed in ${runtimeSurfaceContext.comparisonLabel} `
        + `(${runtimeSurfaceContext.changedSurfacePaths.join(', ')}) but candidate version ${runtimeSurfaceContext.currentVersion} `
        + `does not advance published ${runtimeSurfaceContext.baseVersion}; bump major.minor after a stable release or advance the prerelease identifier`,
      );
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SDK version matrix check failed:\n');
    for (const v of violations) {
      process.stderr.write(`  - ${v}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `SDK version matrix check passed (${packageVersions.size} primary packages, `
    + `${KIT_NATIVE_PACKAGES.length} Kit native packages, `
    + `${RUNTIME_NPM_PACKAGES.length + 1} Runtime npm packages, `
    + `${SHELL_CRATES.length} shell crates)\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`check-sdk-version-matrix failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
