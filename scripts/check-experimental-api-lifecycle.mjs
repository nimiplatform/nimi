#!/usr/bin/env node

/**
 * Experimental API lifecycle check — ensures no experimental API has exceeded
 * its allowed lifecycle (2 minor versions from introduction).
 *
 * Convention: experimental APIs live under `experimental/` paths and must
 * include a `@experimental` JSDoc tag with `@since <version>`.
 *
 * This script:
 * 1. Scans sdk packages src dirs for files under experimental paths
 * 2. Checks for @since annotations with version info
 * 3. Compares against current package version to detect overdue promotions
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SDK_ROOT = path.join(repoRoot, 'sdk', 'packages');
const MAX_MINOR_VERSIONS = 2;

async function collectFiles(dir, pattern) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(full, pattern)));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function parseVersion(v) {
  const parts = String(v).replace(/^[^0-9]*/, '').split('.');
  return { major: Number(parts[0]) || 0, minor: Number(parts[1]) || 0, patch: Number(parts[2]) || 0 };
}

async function main() {
  const violations = [];
  const experimentalFiles = [];

  // Find all experimental paths
  const packages = await fs.readdir(SDK_ROOT, { withFileTypes: true });
  for (const pkg of packages) {
    if (!pkg.isDirectory()) continue;
    const srcDir = path.join(SDK_ROOT, pkg.name, 'src');
    const files = await collectFiles(srcDir, /\.tsx?$/);
    for (const file of files) {
      const relative = path.relative(repoRoot, file);
      if (relative.includes('/experimental/') || relative.includes('\\experimental\\')) {
        experimentalFiles.push({ file, relative, package: pkg.name });
      }
    }
  }

  if (experimentalFiles.length === 0) {
    process.stdout.write('Experimental API lifecycle check passed (no experimental APIs found)\n');
    return;
  }

  // For each experimental file, check @since annotation
  for (const { file, relative, package: pkgName } of experimentalFiles) {
    const content = await fs.readFile(file, 'utf8');
    const sinceMatch = content.match(/@since\s+(\d+\.\d+\.\d+)/);

    if (!sinceMatch) {
      violations.push(`${relative}: missing @since version annotation (required for experimental APIs)`);
      continue;
    }

    // Read current package version
    const pkgJsonPath = path.join(SDK_ROOT, pkgName, 'package.json');
    let currentVersion;
    try {
      const raw = await fs.readFile(pkgJsonPath, 'utf8');
      currentVersion = JSON.parse(raw).version;
    } catch {
      violations.push(`${relative}: cannot read package version from ${pkgName}/package.json`);
      continue;
    }

    const since = parseVersion(sinceMatch[1]);
    const current = parseVersion(currentVersion);

    // Check if experimental API has exceeded lifecycle
    const minorDiff = (current.major - since.major) * 100 + (current.minor - since.minor);
    if (minorDiff > MAX_MINOR_VERSIONS) {
      violations.push(
        `${relative}: experimental API introduced in ${sinceMatch[1]} but current version is ${currentVersion} ` +
        `(exceeded ${MAX_MINOR_VERSIONS} minor version lifecycle — must promote to stable or remove)`
      );
    }
  }

  if (violations.length > 0) {
    process.stderr.write('Experimental API lifecycle check failed:\n');
    for (const v of violations) {
      process.stderr.write(`  - ${v}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Experimental API lifecycle check passed (${experimentalFiles.length} experimental file(s) within lifecycle)\n`
  );
}

main().catch((error) => {
  process.stderr.write(`check-experimental-api-lifecycle failed: ${String(error)}\n`);
  process.exitCode = 1;
});
