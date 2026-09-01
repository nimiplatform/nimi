#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterSecretScanFiles,
  excludedArtifactBaselineEntries,
} from './lib/secret-scan-scope.mjs';
import { shouldApplySecretBaselineUpdate } from './lib/secret-scan-result.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const baselinePath = '.secrets.baseline';
const chunkSize = 200;
const updateMode = process.argv.slice(2).includes('--update');

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

function repositoryFiles() {
  const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
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

  const excludedEntries = excludedArtifactBaselineEntries(baseline);
  if (excludedEntries.length === 0) return;

  fail([
    `${baselinePath} contains entries for files excluded by scripts/lib/secret-scan-scope.mjs.`,
    'Excluded files must name their source and direct drift or behavior gate instead of duplicating per-value baseline entries.',
    'Remove these baseline entries:',
    ...excludedEntries.map((entry) => `  - ${entry}`),
  ].join('\n'));
}

function normalizeBaselinePaths(baseline, separator) {
  const results = {};
  for (const [fileName, findings] of Object.entries(baseline.results || {})) {
    const normalizedFileName = fileName.replace(/[\\/]/gu, separator);
    results[normalizedFileName] = findings.map((finding) => ({
      ...finding,
      filename: String(finding.filename || fileName).replace(/[\\/]/gu, separator),
    }));
  }
  const filtersUsed = (baseline.filters_used || []).map((filter) => (
    filter.path === 'detect_secrets.filters.common.is_baseline_file'
      ? { ...filter, filename: baselinePath }
      : filter
  ));
  return { ...baseline, filters_used: filtersUsed, results };
}

function prepareScannerBaseline() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-secret-scan-'));
  const scannerBaselinePath = path.join(tempDir, 'baseline.json');
  const baseline = JSON.parse(readFileSync(path.join(repoRoot, baselinePath), 'utf8'));
  const scannerSeparator = process.platform === 'win32' ? '\\' : '/';
  writeFileSync(scannerBaselinePath, `${JSON.stringify(normalizeBaselinePaths(baseline, scannerSeparator), null, 2)}\n`);
  return {
    tempDir,
    scannerBaselinePath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

function syncPortableBaseline(scannerBaselinePath) {
  const baseline = JSON.parse(readFileSync(scannerBaselinePath, 'utf8'));
  const portable = normalizeBaselinePaths(baseline, '/');
  writeFileSync(path.join(repoRoot, baselinePath), `${JSON.stringify(portable, null, 2)}\n`);
}

function runDetectSecretsHook(args) {
  const direct = spawnSync('detect-secrets-hook', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!direct.error) {
    return direct;
  }
  if (direct.error.code !== 'ENOENT') {
    fail(`detect-secrets-hook failed to start: ${direct.error.message}`);
  }
  return run('python', ['-m', 'detect_secrets.pre_commit_hook', ...args]);
}

function runDetectSecrets(scannedFiles, scannerBaselinePath) {
  let baselineUpdated = false;
  for (let index = 0; index < scannedFiles.length; index += chunkSize) {
    const chunk = scannedFiles.slice(index, index + chunkSize);
    const result = runDetectSecretsHook(['--baseline', scannerBaselinePath, ...chunk]);
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    const status = result.status ?? 1;
    if (status === 3) {
      baselineUpdated = true;
      continue;
    }
    if (status !== 0) {
      return { status, baselineUpdated };
    }
  }
  return { status: baselineUpdated ? 3 : 0, baselineUpdated };
}

function printPortableBaselineDiff(scannerBaselinePath, tempDir) {
  const baseline = JSON.parse(readFileSync(scannerBaselinePath, 'utf8'));
  const portablePath = path.join(tempDir, 'portable-baseline.json');
  writeFileSync(portablePath, `${JSON.stringify(normalizeBaselinePaths(baseline, '/'), null, 2)}\n`);
  const result = run('git', ['diff', '--no-index', '--', baselinePath, portablePath]);
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
}

function main() {
  assertBaselineScope();

  const { scanned: scopedFiles, excluded } = filterSecretScanFiles(repositoryFiles());
  const scanned = scopedFiles.filter((fileName) => fileName !== baselinePath);
  if (scanned.length === 0) {
    fail('secret scan scope resolved to zero files');
  }

  const preparedBaseline = prepareScannerBaseline();
  try {
    const result = runDetectSecrets(scanned, preparedBaseline.scannerBaselinePath);
    if (result.status !== 0 && result.status !== 3) {
      process.exitCode = result.status;
      return;
    }
    if (shouldApplySecretBaselineUpdate(result, updateMode)) {
      syncPortableBaseline(preparedBaseline.scannerBaselinePath);
      process.stdout.write(`${baselinePath} updated explicitly\n`);
      return;
    }
    if (result.baselineUpdated) {
      printPortableBaselineDiff(preparedBaseline.scannerBaselinePath, preparedBaseline.tempDir);
      process.stderr.write(`${baselinePath} drift detected; run pnpm update:secrets-baseline to apply it explicitly\n`);
    }
    if (result.status !== 0) {
      process.exitCode = result.status;
      return;
    }
  } finally {
    preparedBaseline.cleanup();
  }

  process.stdout.write(`secret baseline gate passed: scanned ${scanned.length} repository files; excluded ${excluded.length} registered files\n`);
}

main();
