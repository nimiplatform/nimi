#!/usr/bin/env node

/**
 * License file map check — verifies LICENSE files exist in required directories
 * with correct license types per the multi-license repo structure.
 *
 * Structure:
 *   runtime/, sdks/typescript/, proto/, app-tools/, npm-packages/ -> Apache-2.0
 *   apps/, kit/                         -> MIT
 *   app-tools/templates/default-starter/, app-tools/templates/app-source/ -> MIT
 *   docs/                              -> CC-BY-4.0
 *   .nimi/spec/                        -> CC-BY-4.0 declared by root LICENSE (authority input stays closed)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const LICENSE_MAP = [
  {
    dirs: [
      'runtime',
      'sdks/typescript',
      'proto',
      'app-tools',
      'npm-packages/nimi',
      'npm-packages/nimi-darwin-arm64',
      'npm-packages/nimi-darwin-x64',
      'npm-packages/nimi-linux-arm64',
      'npm-packages/nimi-linux-x64',
      'npm-packages/nimi-win32-arm64',
      'npm-packages/nimi-win32-x64',
    ],
    license: 'Apache-2.0',
    canonicalFile: 'licenses/Apache-2.0.txt',
  },
  {
    dirs: [
      'apps/avatar',
      'apps/desktop',
      'apps/install-gateway',
      'apps/lab',
      'apps/prototype2',
      'apps/simulator',
      'apps/web',
      'apps/zhiyu',
      'kit',
      'kit/shell/protected-local',
      'kit/shell/protected-local-node/npm/darwin-arm64',
      'kit/shell/protected-local-node/npm/win32-x64',
      'kit/shell/tauri',
      'app-tools/templates/default-starter',
      'app-tools/templates/app-source',
    ],
    license: 'MIT',
    canonicalFile: 'licenses/MIT.txt',
  },
  {
    dirs: ['docs'],
    license: 'CC-BY-4.0',
    canonicalFile: 'licenses/CC-BY-4.0.txt',
  },
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
  for (const { dirs, license, canonicalFile } of LICENSE_MAP) {
    const canonicalPath = path.join(repoRoot, canonicalFile);
    if (!(await fileExists(canonicalPath))) {
      violations.push(`missing canonical ${license} text at ${canonicalFile}`);
      continue;
    }
    const canonicalContent = await fs.readFile(canonicalPath, 'utf8');
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
      if (content !== canonicalContent) {
        violations.push(`${dir}/LICENSE must exactly match ${canonicalFile} (${license})`);
      }
    }
  }

  // Check root LICENSE exists
  const rootLicense = path.join(repoRoot, 'LICENSE');
  if (!(await fileExists(rootLicense))) {
    violations.push('missing root LICENSE file');
  } else {
    const content = await fs.readFile(rootLicense, 'utf8');
    if (!content.includes('`.nimi/spec/**`') || !content.includes('CC-BY-4.0')) {
      violations.push('root LICENSE must declare .nimi/spec/** as CC-BY-4.0');
    }
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
