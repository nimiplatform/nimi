#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, '..');
const testRoot = path.join(workspaceRoot, 'test');
const i18nTestRelativePath = path.posix.join('test', 'i18n.test.ts');

function collectTestFiles(dirPath) {
  const entries = readdirSync(dirPath).sort((left, right) => left.localeCompare(right));
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      files.push(...collectTestFiles(entryPath));
      continue;
    }
    if (stat.isFile() && entry.endsWith('.test.ts')) {
      files.push(path.relative(workspaceRoot, entryPath).replace(/\\/g, '/'));
    }
  }
  return files;
}

const mode = process.argv[2];
const allTestFiles = collectTestFiles(testRoot);
const selectedTestFiles = allTestFiles.filter((filePath) => {
  if (mode === '--i18n') {
    return filePath === i18nTestRelativePath;
  }
  if (mode === '--rest') {
    return filePath !== i18nTestRelativePath;
  }
  return true;
});

if (mode !== '--i18n' && mode !== '--rest') {
  process.stderr.write(`run-unit-tests.mjs: unsupported mode ${String(mode || '')}\n`);
  process.exit(1);
}

if (selectedTestFiles.length === 0) {
  process.stderr.write(`run-unit-tests.mjs: no test files selected for mode ${mode}\n`);
  process.exit(1);
}

const args = ['exec', 'tsx', '--test'];
if (mode === '--i18n') {
  args.push('--test-concurrency=1');
}
args.push(...selectedTestFiles);

const result = spawnSync(PNPM_BIN, args, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
