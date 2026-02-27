#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const outputPath = path.join(distDir, binaryName);

mkdirSync(distDir, { recursive: true });

const result = spawnSync('go', ['build', '-o', outputPath, './cmd/nimi'], {
  cwd: runtimeDir,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  process.stderr.write(`[build-runtime] failed to start go build: ${result.error.message}\n`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.stdout.write(`[build-runtime] built ${path.relative(repoRoot, outputPath)}\n`);
