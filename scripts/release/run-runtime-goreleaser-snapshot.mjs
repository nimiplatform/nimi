#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

function main() {
  const result = spawnSync(
    'go',
    [
      'run',
      'github.com/goreleaser/goreleaser/v2@latest',
      'release',
      '--clean',
      '--snapshot',
      '--skip=publish',
      '--skip=announce',
      '--skip=sign',
      '--skip=sbom',
      '--config',
      '.goreleaser.yml',
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? (result.signal ? 1 : 0));
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[runtime-goreleaser-snapshot] ${error.stack ?? error.message ?? String(error)}\n`,
  );
  process.exit(1);
}
