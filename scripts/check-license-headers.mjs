#!/usr/bin/env node

/**
 * License file map check — verifies LICENSE files exist in required directories
 * with correct license types per the multi-license repo structure.
 *
 * Structure:
 *   runtime/, sdk/, proto/        -> Apache-2.0
 *   apps/desktop/, apps/web/, apps/_libs/, nimi-mods/ -> MIT
 *   docs/                         -> CC-BY-4.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const LICENSE_MAP = [
  { dirs: ['runtime', 'sdk', 'proto'], license: 'Apache-2.0', markers: ['Apache-2.0', 'Apache License'] },
  { dirs: ['apps/desktop', 'apps/web', 'apps/_libs', 'nimi-mods'], license: 'MIT', markers: ['MIT', 'MIT License'] },
  { dirs: ['docs'], license: 'CC-BY-4.0', markers: ['CC-BY-4.0', 'Creative Commons'] },
];

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const violations = [];

  // Check root licenses directory
  const licensesDir = path.join(repoRoot, 'licenses');
  if (!(await fileExists(licensesDir))) {
    violations.push('missing licenses/ directory at repo root');
  }

  // Check each directory has correct LICENSE
  for (const { dirs, license, markers } of LICENSE_MAP) {
    for (const dir of dirs) {
      const dirPath = path.join(repoRoot, dir);
      if (!(await fileExists(dirPath))) {
        continue; // directory may not exist yet
      }

      const licensePath = path.join(dirPath, 'LICENSE');
      if (!(await fileExists(licensePath))) {
        violations.push(`missing LICENSE in ${dir}/ (expected ${license})`);
        continue;
      }

      const content = await fs.readFile(licensePath, 'utf8');
      const hasMarker = markers.some((m) => content.includes(m));
      if (!hasMarker) {
        violations.push(`${dir}/LICENSE does not appear to be ${license} (missing any of: ${markers.join(', ')})`);
      }
    }
  }

  // Check root LICENSE exists
  const rootLicense = path.join(repoRoot, 'LICENSE');
  if (!(await fileExists(rootLicense))) {
    violations.push('missing root LICENSE file');
  }

  if (violations.length > 0) {
    process.stderr.write('License file map check failed:\n');
    for (const v of violations) {
      process.stderr.write(`  - ${v}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('License file map check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-license-file-map failed: ${String(error)}\n`);
  process.exitCode = 1;
});
