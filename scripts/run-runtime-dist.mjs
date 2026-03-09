#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const binaryPath = path.join(distDir, binaryName);

if (!fs.existsSync(binaryPath)) {
  process.stderr.write(`[run-runtime-dist] missing ${path.relative(repoRoot, binaryPath)}; run 'pnpm build:runtime' first.\n`);
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  process.stderr.write(`[run-runtime-dist] failed to start ${path.relative(repoRoot, binaryPath)}: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
