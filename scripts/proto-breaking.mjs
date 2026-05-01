#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const baselinePath = path.join(repoRoot, 'runtime', 'proto', 'runtime-v1.baseline.binpb');

if (!fs.existsSync(baselinePath) || fs.statSync(baselinePath).size === 0) {
  console.error(`[proto:breaking] failed: baseline is missing or empty: ${baselinePath}`);
  console.error('[proto:breaking] run: (cd runtime && make proto-baseline)');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  path.join(scriptDir, 'run-buf.mjs'),
  'breaking',
  '--against',
  baselinePath,
], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
