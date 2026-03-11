#!/usr/bin/env node

/**
 * SDK version check — unified single package mode.
 */

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SDK_PACKAGES = [
  'sdk',
  'dev-tools',
];
const PUBLIC_RUNTIME_SURFACE_PATHS = [
  'sdk/src/runtime/index.ts',
  'sdk/src/runtime/types.ts',
  'sdk/src/runtime/types-runtime-modules.ts',
  'sdk/src/types/index.ts',
];

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

function readPackageVersionFromGit(ref) {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) {
    return '';
  }
  const result = runGit(['show', `${normalizedRef}:sdk/package.json`]);
  if (result.status !== 0) {
    return '';
  }
  try {
    return String(JSON.parse(result.stdout).version || '').trim();
  } catch {
    return '';
  }
}

function detectRuntimeSurfaceVersionContext(currentVersion) {
  const baseRef = String(process.env.NIMI_BASE_SHA || '').trim() || 'HEAD~1';
  const focusPaths = [...PUBLIC_RUNTIME_SURFACE_PATHS, 'sdk/package.json'];

  const worktreeChangedPaths = listGitPaths(['diff', '--name-only', 'HEAD', '--', ...focusPaths]);
  const worktreeSurfacePaths = worktreeChangedPaths.filter((filePath) => PUBLIC_RUNTIME_SURFACE_PATHS.includes(filePath));
  if (worktreeSurfacePaths.length > 0) {
    const baseVersion = readPackageVersionFromGit('HEAD');
    if (!baseVersion) {
      return null;
    }
    return {
      changedSurfacePaths: worktreeSurfacePaths,
      baseVersion,
      currentVersion,
      comparisonLabel: 'HEAD -> worktree',
    };
  }

  const range = `${baseRef}...HEAD`;
  const rangeChangedPaths = listGitPaths(['diff', '--name-only', range, '--', ...focusPaths]);
  const rangeSurfacePaths = rangeChangedPaths.filter((filePath) => PUBLIC_RUNTIME_SURFACE_PATHS.includes(filePath));
  if (rangeSurfacePaths.length === 0) {
    return null;
  }
  const baseVersion = readPackageVersionFromGit(baseRef);
  if (!baseVersion) {
    return null;
  }
  return {
    changedSurfacePaths: rangeSurfacePaths,
    baseVersion,
    currentVersion,
    comparisonLabel: `${baseRef} -> HEAD`,
  };
}

async function main() {
  const violations = [];
  const packageVersions = new Map();

  // Read all package.json files
  for (const pkg of SDK_PACKAGES) {
    const pkgJsonPath = path.join(repoRoot, pkg, 'package.json');
    let raw;
    try {
      raw = await fs.readFile(pkgJsonPath, 'utf8');
    } catch {
      violations.push(`missing package.json: ${pkg}/package.json`);
      continue;
    }
    const parsed = JSON.parse(raw);
    packageVersions.set(parsed.name, { version: parsed.version, path: pkg, pkg: parsed });
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

  // Check all packages have the same major.minor version (patch can differ)
  const versions = [...packageVersions.entries()].map(([name, { version }]) => ({
    name,
    version,
    majorMinor: parseMajorMinor(version),
  }));
  const majorMinorSet = new Set(versions.map((v) => v.majorMinor));
  if (majorMinorSet.size > 1) {
    const details = versions.map((v) => `  ${v.name}: ${v.version}`).join('\n');
    violations.push(`SDK packages have inconsistent major.minor versions:\n${details}`);
  }

  const exactVersionSet = new Set(versions.map((v) => v.version));
  if (exactVersionSet.size > 1) {
    const details = versions.map((v) => `  ${v.name}: ${v.version}`).join('\n');
    violations.push(`npm author release-set packages must share the exact same version:\n${details}`);
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
  }

  const sdkVersion = packageVersions.get('@nimiplatform/sdk')?.version || '';
  const devToolsVersion = packageVersions.get('@nimiplatform/dev-tools')?.version || '';
  const expectedSdkRange = sdkVersion ? `^${sdkVersion}` : '';
  const expectedDevToolsRange = devToolsVersion ? `^${devToolsVersion}` : '';

  const examplesModTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, 'examples/mod-template/package.json'), 'utf8'));
  if (examplesModTemplate.dependencies?.['@nimiplatform/sdk'] !== expectedSdkRange) {
    violations.push(
      `examples/mod-template/package.json must depend on @nimiplatform/sdk as "${expectedSdkRange}"`,
    );
  }
  if (examplesModTemplate.devDependencies?.['@nimiplatform/dev-tools'] !== expectedDevToolsRange) {
    violations.push(
      `examples/mod-template/package.json must depend on @nimiplatform/dev-tools as "${expectedDevToolsRange}"`,
    );
  }

  const examplesAppTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, 'examples/app-template/package.json'), 'utf8'));
  if (examplesAppTemplate.dependencies?.['@nimiplatform/sdk'] !== expectedSdkRange) {
    violations.push(
      `examples/app-template/package.json must depend on @nimiplatform/sdk as "${expectedSdkRange}"`,
    );
  }

  const devToolsSource = await fs.readFile(path.join(repoRoot, 'dev-tools/lib/index.mjs'), 'utf8');
  const sdkVersionMatch = devToolsSource.match(/const SDK_VERSION = '([^']+)';/);
  const devToolsVersionMatch = devToolsSource.match(/const DEV_TOOLS_VERSION = '([^']+)';/);
  if (!sdkVersionMatch || sdkVersionMatch[1] !== expectedSdkRange) {
    violations.push(`dev-tools/lib/index.mjs SDK_VERSION must be "${expectedSdkRange}"`);
  }
  if (!devToolsVersionMatch || devToolsVersionMatch[1] !== expectedDevToolsRange) {
    violations.push(`dev-tools/lib/index.mjs DEV_TOOLS_VERSION must be "${expectedDevToolsRange}"`);
  }

  const sdkPackage = packageVersions.get('@nimiplatform/sdk');
  if (sdkPackage?.version) {
    const runtimeSurfaceContext = detectRuntimeSurfaceVersionContext(sdkPackage.version);
    if (
      runtimeSurfaceContext
      && parseMajorMinor(runtimeSurfaceContext.baseVersion) === parseMajorMinor(runtimeSurfaceContext.currentVersion)
    ) {
      violations.push(
        `@nimiplatform/sdk public runtime surface changed in ${runtimeSurfaceContext.comparisonLabel} `
        + `(${runtimeSurfaceContext.changedSurfacePaths.join(', ')}) but version stayed within ${parseMajorMinor(runtimeSurfaceContext.currentVersion)}; `
        + `bump major.minor for breaking or surface-affecting runtime API edits`,
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

  process.stdout.write(`SDK version matrix check passed (${packageVersions.size} packages)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-sdk-version-matrix failed: ${String(error)}\n`);
  process.exitCode = 1;
});
