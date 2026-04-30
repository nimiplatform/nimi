import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const forbidden = '@nimiplatform/core-api-client';
const skippedDirs = new Set([
  '.cache',
  '.git',
  '.iterate',
  'archive',
  'dist',
  'docs',
  'gen',
  'generated',
  'node_modules',
  '_external',
]);
const scannedExts = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'check-no-legacy-imports.mjs') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirs.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!scannedExts.has(ext)) continue;
    if (statSync(full).size > 1024 * 1024) continue;
    const text = readFileSync(full, 'utf8');
    if (!text.includes(forbidden)) continue;
    const rel = path.relative(root, full);
    text.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(forbidden)) violations.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
}

walk(root);

if (violations.length > 0) {
  console.error(`legacy import ${forbidden} is forbidden`);
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('legacy import check passed');
