#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set([
  'dist',
  'build',
  'coverage',
  'node_modules',
  'generated',
  'gen',
  '.turbo',
  '.next',
  'spec',
  'test',
  'tests',
]);

const IGNORED_FILE_PATTERNS = [
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
  /\.d\.ts$/,
];

const ALLOWLIST = new Set([
  'apps/relay/src/main/realm-agent-channel.ts',
]);

const CHECKS = [
  {
    label: 'raw.request',
    pattern: /\braw\.request(?:<[\s\S]*?>)?\s*\(/g,
    message: 'app production code must not call realm.raw.request directly',
  },
  {
    label: 'path literal',
    pattern: /\bpath\s*:\s*['"`]\/api\//g,
    message: 'app production code must not pass literal /api paths',
  },
  {
    label: 'url literal',
    pattern: /\burl\s*:\s*['"`]\/api\//g,
    message: 'app production code must not pass literal /api urls',
  },
  {
    label: 'fetch literal',
    pattern: /\bfetch\s*\(\s*['"`]\/api\//g,
    message: 'app production code must not fetch literal /api routes',
  },
];

function getLine(source, index) {
  return source.slice(0, index).split('\n').length;
}

function shouldSkipFile(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (!normalized.startsWith('apps/')) {
    return true;
  }

  if (normalized.includes('/e2e/fixtures/')) {
    return true;
  }

  if (ALLOWLIST.has(normalized)) {
    return true;
  }

  if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return false;
}

async function walk(dir, visitor) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      const stats = await fs.stat(fullPath);
      isDirectory = stats.isDirectory();
      isFile = stats.isFile();
    }

    if (isDirectory) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walk(fullPath, visitor);
      continue;
    }
    if (!isFile) {
      continue;
    }
    await visitor(fullPath);
  }
}

async function main() {
  const violations = [];

  await walk(path.join(repoRoot, 'apps'), async (fullPath) => {
    const relativePath = path.relative(repoRoot, fullPath);
    const extension = path.extname(relativePath);
    if (!SOURCE_EXTENSIONS.has(extension)) {
      return;
    }
    if (shouldSkipFile(relativePath)) {
      return;
    }

    const source = await fs.readFile(fullPath, 'utf8');
    for (const check of CHECKS) {
      const pattern = new RegExp(check.pattern);
      let match = pattern.exec(source);
      while (match) {
        violations.push(
          `${relativePath}:${getLine(source, match.index)} ${check.label}: ${check.message}`,
        );
        match = pattern.exec(source);
      }
    }
  });

  if (violations.length > 0) {
    process.stderr.write('App Realm REST bypass check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('App Realm REST bypass check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-no-app-realm-rest-bypass failed: ${String(error)}\n`);
  process.exitCode = 1;
});
