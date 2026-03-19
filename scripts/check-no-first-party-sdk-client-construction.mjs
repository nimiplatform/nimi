#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'generated',
  'gen',
  'node_modules',
  'out',
  'spec',
  'test',
  'tests',
]);

const IGNORED_FILE_PATTERNS = [
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
  /\.d\.ts$/,
];

const ALLOWLIST = new Set();

const CHECKS = [
  {
    label: 'new Runtime',
    pattern: /\bnew\s+Runtime\s*\(/g,
    message: 'first-party app production code must use createPlatformClient instead of new Runtime()',
  },
  {
    label: 'new Realm',
    pattern: /\bnew\s+Realm\s*\(/g,
    message: 'first-party app production code must use createPlatformClient instead of new Realm()',
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
  if (ALLOWLIST.has(normalized)) {
    return true;
  }
  if (normalized.includes('/scripts/')) {
    return true;
  }
  if (normalized.includes('/dev/')) {
    return true;
  }
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

async function walk(dir, visitor) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walk(fullPath, visitor);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    await visitor(fullPath);
  }
}

async function main() {
  const violations = [];

  await walk(path.join(repoRoot, 'apps'), async (fullPath) => {
    const relativePath = path.relative(repoRoot, fullPath);
    if (!SOURCE_EXTENSIONS.has(path.extname(relativePath))) {
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
    process.stderr.write('First-party SDK client construction check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('First-party SDK client construction check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-no-first-party-sdk-client-construction failed: ${String(error)}\n`);
  process.exitCode = 1;
});
