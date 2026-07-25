#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Home shell Agent Chat surfaces. Any AI execution call must include
// an explicit AIScopeRef per `.nimi/spec/desktop/ai-consumption.authority.yaml`.
const TARGET_GLOBS = [
  'apps/desktop/src/shell/renderer/features/chat',
  'apps/desktop/src/shell/renderer/features/nimi-home',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['.git', '.next', '.turbo', '.vercel', 'build', 'coverage', 'dist', 'gen', 'generated', 'node_modules', 'out', 'tmp']);
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./];

// Forbidden: any aiProfile.apply / aiProfile.execute call without an
// AIScopeRef literal token nearby. Heuristic: look for calls; if there's
// no AIScopeRef mentioned in the file, flag.
const AI_PROFILE_CALL_PATTERN = /\baiProfile\s*\.\s*(apply|execute)\s*\(/g;
const AISCOPEREF_REFERENCE = /\bAIScopeRef\b/;

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
  const thisFile = path.join(repoRoot, 'scripts', 'check-home-shell-aiscoperef-required.mjs');
  for (const file of files) {
    if (file === thisFile) continue;
    const source = await fs.readFile(file, 'utf8');
    AI_PROFILE_CALL_PATTERN.lastIndex = 0;
    const match = AI_PROFILE_CALL_PATTERN.exec(source);
    if (match && !AISCOPEREF_REFERENCE.test(source)) {
      const { line, column } = getLineColumn(source, match.index);
      const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
      violations.push(`${rel}:${line}:${column}: aiProfile.${match[1]}() call without AIScopeRef reference in file`);
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-aiscoperef-'));
  const negative = path.join(tempRoot, 'negative.ts');
  const positive = path.join(tempRoot, 'positive.ts');
  await fs.writeFile(negative, "import type { AIScopeRef } from '@nimiplatform/sdk';\nawait aiProfile.apply(scopeRef, profileId);\n", 'utf8');
  await fs.writeFile(positive, "await aiProfile.apply(somethingElse, profileId);\n", 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) throw new Error('self-test: negative fixture flagged');
    const pos = await collectViolations([positive]);
    if (pos.length === 0) throw new Error('self-test: positive fixture not flagged');
    process.stdout.write('check-home-shell-aiscoperef-required self-test passed\n');
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
    process.stderr.write('Home shell Agent Chat aiProfile calls must use explicit AIScopeRef per D-AIPC-005.\n');
    for (const v of violations) process.stderr.write(`- ${v}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-home-shell-aiscoperef-required passed (${files.length} file(s) scanned across ${TARGET_GLOBS.length} target glob(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-home-shell-aiscoperef-required failed: ${String(error)}\n`);
  process.exitCode = 1;
});
