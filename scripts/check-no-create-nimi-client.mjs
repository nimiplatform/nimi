#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SOURCE_ROOTS = ['sdk', 'apps', 'docs/examples', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'tmp',
]);

const IMPORT_PATTERN = /\bimport\s+[^;\n]*\bcreateNimiClient\b/g;
const CALL_PATTERN = /\bcreateNimiClient\s*\(/g;

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
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
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
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

async function collectViolations(files) {
  const violations = [];
  const thisFile = path.join(repoRoot, 'scripts', 'check-no-create-nimi-client.mjs');
  for (const file of files) {
    if (file === thisFile) {
      continue;
    }
    const source = await fs.readFile(file, 'utf8');
    for (const pattern of [IMPORT_PATTERN, CALL_PATTERN]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match) {
        const { line, column } = getLineColumn(source, match.index);
        const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');
        violations.push(`${relative}:${line}:${column} contains forbidden createNimiClient usage`);
        match = pattern.exec(source);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-check-no-create-'));
  const prosePath = path.join(tempRoot, 'prose.ts');
  const codePath = path.join(tempRoot, 'code.ts');

  await fs.writeFile(
    prosePath,
    "const note = 'please avoid createNimiClient in docs text';\n",
    'utf8',
  );
  await fs.writeFile(
    codePath,
    "import { createNimiClient } from '@nimiplatform/sdk';\nconst client = createNimiClient({});\n",
    'utf8',
  );

  try {
    const proseViolations = await collectViolations([prosePath]);
    if (proseViolations.length !== 0) {
      throw new Error('self-test failed: prose-only fixture was flagged');
    }

    const codeViolations = await collectViolations([codePath]);
    if (codeViolations.length === 0) {
      throw new Error('self-test failed: code fixture was not flagged');
    }

    process.stdout.write('check-no-create-nimi-client self-test passed\n');
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
  for (const root of SOURCE_ROOTS) {
    files.push(...await collectFiles(path.join(repoRoot, root)));
  }
  const violations = await collectViolations(files);

  if (violations.length > 0) {
    process.stderr.write('createNimiClient is removed; use Runtime/Realm classes\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('createNimiClient usage check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-no-create-nimi-client failed: ${String(error)}\n`);
  process.exitCode = 1;
});
