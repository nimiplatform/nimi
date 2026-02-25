#!/usr/bin/env node

/**
 * SDK version matrix check — verifies all @nimiplatform/* SDK packages
 * declare consistent cross-references and compatible version ranges.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SDK_PACKAGES = [
  'sdk/packages/sdk',
  'sdk/packages/runtime',
  'sdk/packages/realm',
  'sdk/packages/mod-sdk',
  'sdk/packages/types',
  'sdk/packages/ai-provider',
];

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
    majorMinor: version.split('.').slice(0, 2).join('.'),
  }));
  const majorMinorSet = new Set(versions.map((v) => v.majorMinor));
  if (majorMinorSet.size > 1) {
    const details = versions.map((v) => `  ${v.name}: ${v.version}`).join('\n');
    violations.push(`SDK packages have inconsistent major.minor versions:\n${details}`);
  }

  // Check required fields
  for (const [name, { pkg: parsed, path: pkgPath }] of packageVersions) {
    if (!parsed.version) {
      violations.push(`${name} (${pkgPath}) missing "version" field`);
    }
    if (!parsed.license) {
      violations.push(`${name} (${pkgPath}) missing "license" field`);
    }
    if (!parsed.exports && !parsed.main) {
      violations.push(`${name} (${pkgPath}) missing "exports" or "main" field`);
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
