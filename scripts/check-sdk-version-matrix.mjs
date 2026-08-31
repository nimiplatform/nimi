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
  { name: 'nimi-shell-tauri', path: 'kit/shell/tauri/Cargo.toml' },
];
const PUBLIC_RUNTIME_SURFACE_PATHS = [
  'sdks/typescript/runtime/index.ts',
  'sdks/typescript/runtime/runtime-types.ts',
  'sdks/typescript/runtime/runtime-facade-types.ts',
  'sdks/typescript/types/index.ts',
];
const PUBLIC_REPOSITORY_URL = 'https://github.com/nimiplatform/nimi';

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

function listGitPaths(args) {
  const result = runGit(args);
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

function readPackageVersionFromGit(ref) {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) {
    return '';
  }
  const result = runGit(['show', `${normalizedRef}:${SDK_PACKAGE_PATH}/package.json`]);
  if (result.status !== 0) {
    return '';
  }
  try {
    return String(JSON.parse(result.stdout).version || '').trim();
  } catch {
    return '';
  }
}

function latestPublishedSdkRef() {
  const override = String(process.env.NIMI_PUBLISHED_SDK_REF || '').trim();
  if (override) return override;
  return listGitPaths(['tag', '--merged', 'HEAD', '--list', 'sdk/v*', '--sort=-version:refname'])[0] || '';
}

function isPrereleaseVersion(version) {
  return String(version || '').includes('-');
}

function detectRuntimeSurfaceVersionContext(currentVersion) {
  const baseRef = latestPublishedSdkRef();
  if (!baseRef) return null;
  const committedPaths = listGitPaths(['diff', '--name-only', `${baseRef}...HEAD`, '--', ...PUBLIC_RUNTIME_SURFACE_PATHS]);
  const worktreePaths = listGitPaths(['diff', '--name-only', 'HEAD', '--', ...PUBLIC_RUNTIME_SURFACE_PATHS]);
  const changedSurfacePaths = [...new Set([...committedPaths, ...worktreePaths])];
  if (changedSurfacePaths.length === 0) return null;
  const baseVersion = readPackageVersionFromGit(baseRef);
  if (!baseVersion) return null;
  return {
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
  const shellVersion = shellCrates[0]?.version || '';
  for (const crate of shellCrates.slice(1)) {
    if (crate.version !== shellVersion) {
      violations.push(`${crate.name} version ${crate.version || '<missing>'} must match nimi-shell-protected-local ${shellVersion}`);
    }
  }
  for (const crate of shellCrates.filter((item) => item.name !== 'nimi-shell-protected-local')) {
    const dependencyVersion = readInlineCargoDependencyVersion(crate.source, 'nimi-shell-protected-local');
    if (dependencyVersion !== shellVersion) {
      violations.push(`${crate.name} dependency nimi-shell-protected-local must be exact version ${shellVersion}`);
    }
  }

  const scaffoldVersions = packageVersions.get('@nimiplatform/app-tools')?.pkg?.nimiScaffoldVersions;
  if (scaffoldVersions?.sdkVersion !== expectedSdkRange) {
    violations.push(`app-tools/package.json nimiScaffoldVersions.sdkVersion must be "${expectedSdkRange}"`);
  }
  if (scaffoldVersions?.kitVersion !== expectedKitRange) {
    violations.push(`app-tools/package.json nimiScaffoldVersions.kitVersion must be "${expectedKitRange}"`);
  }
  if (scaffoldVersions?.appToolsVersion !== expectedAppToolsRange) {
    violations.push(`app-tools/package.json nimiScaffoldVersions.appToolsVersion must be "${expectedAppToolsRange}"`);
  }
  if (scaffoldVersions?.nimiShellTauriVersion !== shellVersion) {
    violations.push(`app-tools/package.json nimiScaffoldVersions.nimiShellTauriVersion must be "${shellVersion}"`);
  }

  if (sdkPackage?.version) {
    const runtimeSurfaceContext = detectRuntimeSurfaceVersionContext(sdkPackage.version);
    const versionNotAdvanced = runtimeSurfaceContext && (
      isPrereleaseVersion(runtimeSurfaceContext.baseVersion)
        ? runtimeSurfaceContext.baseVersion === runtimeSurfaceContext.currentVersion
        : parseMajorMinor(runtimeSurfaceContext.baseVersion) === parseMajorMinor(runtimeSurfaceContext.currentVersion)
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

main().catch((error) => {
  process.stderr.write(`check-sdk-version-matrix failed: ${String(error)}\n`);
  process.exitCode = 1;
});
