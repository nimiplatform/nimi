#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const rendererRoot = path.join(repoRoot, 'apps/desktop/src/shell/renderer');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const ALLOWLIST_FILES = new Set([
  'apps/desktop/src/shell/renderer/components/scroll-shell.tsx',
]);

const BANNED_PATTERNS = [
  {
    label: 'legacy app-scroll-shell class',
    regex: /\bapp-scroll-shell\b/g,
  },
  {
    label: 'raw overflow-y-auto class',
    regex: /\boverflow-y-auto\b/g,
  },
  {
    label: 'raw overflow-auto class',
    regex: /\boverflow-auto\b/g,
  },
];

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function toLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const lines = prefix.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function shouldSkipFile(relativePath) {
  return ALLOWLIST_FILES.has(relativePath);
}

async function collectSourceFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    files.push(fullPath);
  }
  return files;
}

async function main() {
  const files = await collectSourceFiles(rendererRoot);
  const violations = [];

  for (const file of files) {
    const relativePath = toRepoRelative(file);
    if (shouldSkipFile(relativePath)) {
      continue;
    }

    const source = await fs.readFile(file, 'utf8');
    for (const { label, regex } of BANNED_PATTERNS) {
      regex.lastIndex = 0;
      let match = regex.exec(source);
      while (match) {
        const { line, column } = toLineColumn(source, match.index ?? 0);
        violations.push(`${relativePath}:${line}:${column} ${label}`);
        match = regex.exec(source);
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('Desktop scroll containers must use ScrollShell:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`Desktop scroll shell check passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-desktop-scroll-shell failed: ${String(error)}\n`);
  process.exit(1);
});
