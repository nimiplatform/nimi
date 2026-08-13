#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

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
  'dist-electron',
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

const ALLOWLIST = new Set([
  // Desktop's single SDK session entry. Production callers must consume the
  // exported accessors instead of constructing Runtime/Realm elsewhere.
  'apps/desktop/src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts',
  // The Web account surface uses a cookie-bearing first-party Realm client;
  // it does not create a Runtime client or retain bearer material.
  'apps/web/src/auth/web-account-adapter.ts',
]);

const FIRST_PARTY_RUNTIME_CALLER_MODES = new Set([
  'desktop-shell',
  'local-first-party',
]);

const CHECKS = [
  {
    label: 'new Runtime',
    pattern: /\bnew\s+Runtime\s*\(/g,
    message: 'first-party app production code must use an admitted vNext SDK session entry instead of constructing Runtime ad hoc',
  },
  {
    label: 'new Realm',
    pattern: /\bnew\s+Realm\s*\(/g,
    message: 'first-party app production code must use an admitted vNext SDK session entry instead of constructing Realm ad hoc',
  },
];

function getLine(source, index) {
  return source.slice(0, index).split('\n').length;
}

async function loadCheckedAppRoots() {
  const tablePath = path.join(repoRoot, 'config/platform-nimi-app-identity-surfaces.yaml');
  const source = await fs.readFile(tablePath, 'utf8');
  const parsed = YAML.parse(source);
  const apps = Array.isArray(parsed?.apps) ? parsed.apps : [];
  const roots = new Set();
  for (const app of apps) {
    const sourceRoot = typeof app?.source_root === 'string' ? app.source_root.trim() : '';
    const callerMode = typeof app?.runtime_caller_mode === 'string' ? app.runtime_caller_mode.trim() : '';
    if (sourceRoot && FIRST_PARTY_RUNTIME_CALLER_MODES.has(callerMode)) {
      roots.add(sourceRoot.replaceAll(path.sep, '/').replace(/\/+$/, ''));
    }
  }
  if (roots.size === 0) {
    throw new Error('no first-party app roots found in nimi-app-identity-surfaces.yaml');
  }
  return roots;
}

function isUnderCheckedAppRoot(normalized, checkedAppRoots) {
  for (const root of checkedAppRoots) {
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      return true;
    }
  }
  return false;
}

function shouldSkipFile(relativePath, checkedAppRoots) {
  const normalized = relativePath.split(path.sep).join('/');
  if (!normalized.startsWith('apps/')) {
    return true;
  }
  if (!isUnderCheckedAppRoot(normalized, checkedAppRoots)) {
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
  const checkedAppRoots = await loadCheckedAppRoots();

  await walk(path.join(repoRoot, 'apps'), async (fullPath) => {
    const relativePath = path.relative(repoRoot, fullPath);
    if (!SOURCE_EXTENSIONS.has(path.extname(relativePath))) {
      return;
    }
    if (shouldSkipFile(relativePath, checkedAppRoots)) {
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
