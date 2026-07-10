#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterSecretScanFiles,
  generatedArtifactBaselineEntries,
} from './lib/secret-scan-scope.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const baselinePath = '.secrets.baseline';
const chunkSize = 200;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }

  return result;
}

function trackedFiles() {
  const result = run('git', ['ls-files', '-z']);
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exit(result.status ?? 1);
  }

  return result.stdout.split('\0').filter(Boolean);
}

function assertBaselineScope() {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(path.join(repoRoot, baselinePath), 'utf8'));
  } catch (error) {
    fail(`failed to read ${baselinePath}: ${error.message}`);
  }

  const generatedEntries = generatedArtifactBaselineEntries(baseline);
  if (generatedEntries.length === 0) return;

  fail([
    `${baselinePath} contains generated artifact allowlist entries.`,
    'Generated artifacts are excluded only when their source authority and drift gate are registered in scripts/lib/secret-scan-scope.mjs.',
    'Remove these baseline entries:',
    ...generatedEntries.map((entry) => `  - ${entry}`),
  ].join('\n'));
}

function runDetectSecrets(scannedFiles) {
  for (let index = 0; index < scannedFiles.length; index += chunkSize) {
    const chunk = scannedFiles.slice(index, index + chunkSize);
    const result = run('detect-secrets-hook', ['--baseline', baselinePath, ...chunk]);
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

function main() {
  assertBaselineScope();

  const { scanned, excluded } = filterSecretScanFiles(trackedFiles());
  if (scanned.length === 0) {
    fail('secret scan scope resolved to zero files');
  }

  runDetectSecrets(scanned);

  process.stdout.write(`secret baseline gate passed: scanned ${scanned.length} tracked files; excluded ${excluded.length} generated artifacts\n`);
}

main();
