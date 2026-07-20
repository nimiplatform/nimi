#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, '..');
const testRoot = path.join(workspaceRoot, 'test');
const i18nTestRelativePath = path.posix.join('test', 'i18n.test.ts');
const desktopRequire = createRequire(path.join(workspaceRoot, 'package.json'));
const tsxLoaderUrl = pathToFileURL(desktopRequire.resolve('tsx')).href;
const testSingletonsUrl = pathToFileURL(path.join(scriptDir, 'register-test-singletons.mjs')).href;

function normalizeFilterPath(input) {
  let normalized = String(input || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized === '--') {
    return '';
  }
  normalized = normalized.replace(/^\.?\//, '');
  if (!normalized.startsWith('test/')) {
    normalized = `test/${normalized}`;
  }
  return normalized;
}

function resolveRequestedTestFiles(allTestFiles, requestedFilters) {
  const filters = requestedFilters.map(normalizeFilterPath).filter(Boolean);
  if (filters.length === 0) {
    return allTestFiles;
  }

  const selected = [];
  const unmatched = [];
  for (const filter of filters) {
    const exact = allTestFiles.find((filePath) => filePath === filter);
    if (exact) {
      selected.push(exact);
      continue;
    }

    const basenameMatches = allTestFiles.filter((filePath) => path.posix.basename(filePath) === path.posix.basename(filter));
    if (basenameMatches.length === 1) {
      selected.push(basenameMatches[0]);
      continue;
    }

    unmatched.push(filter);
  }

  if (unmatched.length > 0) {
    process.stderr.write(`run-unit-tests.mjs: requested test file(s) not found: ${unmatched.join(', ')}\n`);
    process.exit(1);
  }

  return [...new Set(selected)];
}

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
    if (stat.isFile() && (
      entry.endsWith('.test.ts')
      || entry.endsWith('.test.tsx')
      || entry.endsWith('.test.mjs')
    )) {
      files.push(path.relative(workspaceRoot, entryPath).replace(/\\/g, '/'));
    }
  }
  return files;
}

const mode = process.argv[2];
const requestedTestFiles = process.argv.slice(3).filter((arg) => arg !== '--');
const allTestFiles = resolveRequestedTestFiles(collectTestFiles(testRoot), requestedTestFiles);
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

const args = [
  '--import',
  testSingletonsUrl,
  '--import',
  tsxLoaderUrl,
  '--test',
];
if (mode === '--i18n') {
  args.push('--test-concurrency=1');
}

const maxCommandLength = process.platform === 'win32' ? 3000 : 100000;

function commandLength(parts) {
  return [process.execPath, ...parts].join(' ').length;
}

function buildBatches(prefixArgs, filePaths) {
  if (process.platform === 'win32' && mode === '--rest') {
    return filePaths.map((filePath) => [filePath]);
  }
  const batches = [];
  let current = [];
  for (const filePath of filePaths) {
    const next = [...current, filePath];
    if (current.length > 0 && commandLength([...prefixArgs, ...next]) > maxCommandLength) {
      batches.push(current);
      current = [filePath];
      continue;
    }
    current = next;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

let exitStatus = 0;
for (const batch of buildBatches(args, selectedTestFiles)) {
  const result = spawnSync(process.execPath, [...args, ...batch], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: path.join(workspaceRoot, 'tsconfig.test.json'),
    },
    stdio: 'inherit',
  });
  if ((result.status ?? 1) !== 0) {
    exitStatus = result.status ?? 1;
  }
}

process.exit(exitStatus);
