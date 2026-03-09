#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const result = spawnSync('sh', ['scripts/install.sh', '--dry-run'], {
  cwd: repoRoot,
  env: process.env,
  encoding: 'utf8',
});

if (result.error) {
  process.stderr.write(`install script smoke failed to start: ${result.error.message}\n`);
  process.exit(1);
}
if ((result.status ?? 1) !== 0) {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.stderr.write(`install script smoke failed with exit code ${result.status ?? 1}\n`);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout}\n${result.stderr}`;
const required = [
  'Run: nimi start',
  'Run: nimi doctor',
  'Run: nimi run "What is Nimi?"',
];

for (const token of required) {
  if (!output.includes(token)) {
    process.stderr.write(`install script smoke failed: missing ${JSON.stringify(token)}\n`);
    process.exit(1);
  }
}

if (output.includes('Run: nimi serve')) {
  process.stderr.write('install script smoke failed: legacy serve next-step detected\n');
  process.exit(1);
}

process.stdout.write('install script smoke ok\n');
