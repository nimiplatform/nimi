#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Paths that are Home shell / Desktop renderer AIProfile consumer code.
// These paths must only consume the SDK / typed Runtime client interface;
// they must NOT import any Runtime-internal Go path (the Go package is in a
// separate process / language, so TS imports cannot literally cross the
// boundary, but the check prevents accidental re-export of runtime-internal
// types via SDK private deep paths, fetch URLs containing "/internal/", or
// imports from runtime/internal-* TS packages if any exist).
const TARGET_GLOBS = [
  'apps/desktop/src/shell/renderer',
  'apps/desktop/src/runtime/platform-catalog',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['.git', '.next', '.turbo', '.vercel', 'build', 'coverage', 'dist', 'gen', 'generated', 'node_modules', 'out', 'tmp']);
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./];

// Forbidden import path patterns. Captures three categories:
// 1. Runtime-internal Go path string used as URL/fetch target (e.g., "/runtime/internal/")
// 2. SDK runtime-internal deep import (private path)
// 3. Direct module name patterns indicating runtime-internal cross-language reach
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"].*\/runtime\/internal\//,
  /import\s*\(\s*['"].*\/runtime\/internal\//,
  /from\s+['"]@nimiplatform\/sdk\/runtime\/internal/,
  /from\s+['"]@nimiplatform\/runtime-internal/,
];

const FORBIDDEN_FETCH_PATTERNS = [
  /fetch\s*\(\s*['"][^'"]*\/runtime\/internal\//,
];

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const column = index - prefix.lastIndexOf('\n');
  return { line, column };
}

async function collectFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE_PATTERNS.some(re => re.test(entry.name))) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(fullPath);
  }
  return files;
}

async function collectViolations(files) {
  const violations = [];
  const thisFile = path.join(repoRoot, 'scripts', 'check-home-shell-no-runtime-internal-import.mjs');
  for (const file of files) {
    if (file === thisFile) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const pattern of [...FORBIDDEN_IMPORT_PATTERNS, ...FORBIDDEN_FETCH_PATTERNS]) {
      pattern.lastIndex = 0;
      const match = pattern.exec(source);
      if (match) {
        const { line, column } = getLineColumn(source, match.index);
        const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
        violations.push(`${rel}:${line}:${column}: runtime-internal cross-boundary import "${match[0]}"`);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-home-runtime-internal-'));
  const negative = path.join(tempRoot, 'negative.ts');
  const positive = path.join(tempRoot, 'positive.ts');
  await fs.writeFile(negative, "import { NimiAppClient } from '@nimiplatform/sdk/runtime';\n", 'utf8');
  await fs.writeFile(positive, "import { x } from '@nimiplatform/sdk/runtime/internal/private';\n", 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) throw new Error(`self-test: negative fixture flagged: ${neg.join(',')}`);
    const pos = await collectViolations([positive]);
    if (pos.length === 0) throw new Error('self-test: positive fixture not flagged');
    process.stdout.write('check-home-shell-no-runtime-internal-import self-test passed\n');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }
  const files = [];
  for (const target of TARGET_GLOBS) {
    files.push(...await collectFiles(path.join(repoRoot, target)));
  }
  const violations = await collectViolations(files);
  if (violations.length > 0) {
    process.stderr.write('Home shell + Desktop platform-catalog must NOT import runtime-internal paths.\n');
    for (const v of violations) process.stderr.write(`- ${v}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-home-shell-no-runtime-internal-import passed (${files.length} file(s) scanned across ${TARGET_GLOBS.length} target glob(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-home-shell-no-runtime-internal-import failed: ${String(error)}\n`);
  process.exitCode = 1;
});
