#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const LICENSE_CHECKS = [
  { file: 'nimi-mods/package.json', expected: 'MIT' },
  { file: 'apps/_libs/shell-core/package.json', expected: 'MIT' },
  { file: 'sdk/packages/types/package.json', expected: 'Apache-2.0' },
  { file: 'sdk/packages/realm/package.json', expected: 'Apache-2.0' },
  { file: 'sdk/packages/runtime/package.json', expected: 'Apache-2.0' },
  { file: 'sdk/packages/sdk/package.json', expected: 'Apache-2.0' },
  { file: 'sdk/packages/ai-provider/package.json', expected: 'Apache-2.0' },
  { file: 'sdk/packages/mod-sdk/package.json', expected: 'Apache-2.0' },
];

async function main() {
  const violations = [];

  for (const check of LICENSE_CHECKS) {
    const filePath = path.join(repoRoot, check.file);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      violations.push(`${check.file}: failed to read package.json (${String(error)})`);
      continue;
    }

    const actual = String(payload.license || '').trim();
    if (!actual) {
      violations.push(`${check.file}: missing license field (expected "${check.expected}")`);
      continue;
    }
    if (actual !== check.expected) {
      violations.push(`${check.file}: expected "${check.expected}", got "${actual}"`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write('Package license matrix check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Package license matrix check passed (${LICENSE_CHECKS.length} file(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-package-license-matrix failed: ${String(error)}\n`);
  process.exitCode = 1;
});
