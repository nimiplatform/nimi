#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const TARGET_DIRS = ['docs', 'spec', 'examples'];
const TARGET_FILES = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'apps/desktop/src/shell/renderer/mod-source.generated.css',
];

const BANNED_PATTERNS = [
  /\/Users\/[^/\s]+\/[^\s"`']+/g,
  /\/home\/[^/\s]+\/[^\s"`']+/g,
  /[A-Za-z]:\\\\Users\\\\[^\s"`']+/g,
];

function isTextCandidate(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.md' || ext === '.css';
}

async function walk(dir) {
  const output = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile() && isTextCandidate(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

async function collectTargets() {
  const targets = new Set();
  for (const rel of TARGET_DIRS) {
    const abs = path.join(repoRoot, rel);
    try {
      const files = await walk(abs);
      for (const file of files) targets.add(file);
    } catch {
      // ignore missing optional directories
    }
  }
  for (const rel of TARGET_FILES) {
    const abs = path.join(repoRoot, rel);
    try {
      const stat = await fs.stat(abs);
      if (stat.isFile()) targets.add(abs);
    } catch {
      // ignore missing optional files
    }
  }
  return [...targets];
}

function toLineCol(content, index) {
  const prefix = content.slice(0, index);
  const lines = prefix.split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

async function main() {
  const files = await collectTargets();
  const violations = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    for (const pattern of BANNED_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const value = String(match[0] || '');
        const index = match.index ?? -1;
        if (index < 0) continue;
        const { line, col } = toLineCol(content, index);
        violations.push({
          file: path.relative(repoRoot, file).replace(/\\/g, '/'),
          line,
          col,
          value,
        });
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('Absolute user-home paths are forbidden:\n');
    for (const violation of violations) {
      process.stderr.write(
        `  - ${violation.file}:${violation.line}:${violation.col} -> ${violation.value}\n`,
      );
    }
    process.exit(1);
  }

  process.stdout.write(`Absolute user-home path check passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-no-absolute-user-paths failed: ${String(error)}\n`);
  process.exit(1);
});
