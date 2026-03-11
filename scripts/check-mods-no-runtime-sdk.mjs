#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const candidateRoots = [
  path.join(repoRoot, 'examples', 'mods'),
  path.join(repoRoot, 'nimi-mods'),
];
const targetExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const violations = [];
const ignoredDirNames = new Set([
  'node_modules',
  'dist',
  'coverage',
  'generated',
  'gen',
  'test',
  'tests',
  '__tests__',
  'spec',
]);

function toPosix(input) {
  return input.replace(/\\/g, '/');
}

function collectFiles(dir, output) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirNames.has(entry.name)) {
        continue;
      }
      collectFiles(absPath, output);
      continue;
    }
    if (entry.isFile() && targetExtensions.has(path.extname(entry.name))) {
      output.push(absPath);
    }
  }
}

function scanRoot(rootDir) {
  const files = [];
  collectFiles(rootDir, files);
  for (const absPath of files) {
    const content = fs.readFileSync(absPath, 'utf8');
    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index]?.includes('@nimiplatform/sdk/runtime')) {
        continue;
      }
      violations.push(`${toPosix(path.relative(repoRoot, absPath))}:${index + 1}`);
    }
  }
}

const existingRoots = candidateRoots.filter((rootDir) => fs.existsSync(rootDir) && fs.statSync(rootDir).isDirectory());
if (existingRoots.length === 0) {
  process.stdout.write('[check-mods-no-runtime-sdk] skipped: no co-located mod workspaces found\n');
  process.exit(0);
}

for (const rootDir of existingRoots) {
  scanRoot(rootDir);
}

if (violations.length > 0) {
  process.stderr.write('mods must not import runtime sdk directly:\n');
  for (const violation of violations) {
    process.stderr.write(`  - ${violation}\n`);
  }
  process.exit(1);
}

process.stdout.write(`[check-mods-no-runtime-sdk] passed for: ${existingRoots.map((rootDir) => path.relative(repoRoot, rootDir)).join(', ')}\n`);
