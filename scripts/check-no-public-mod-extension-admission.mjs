#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Targets: Nimi App registry table rows + registry consumer code. Per
// P-NAPP-012 and P-MOEX-002.a/P-MOEX-006, public Mod and Extension product
// kinds are not admitted as Nimi App registry entries. This gate scans the
// canonical app registry YAML + SDK app client + Runtime app service for any
// admission of `appKind: public-mod` / `appKind: extension` / equivalent
// variants.

const TARGET_GLOBS = [
  '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
  'runtime/internal/services/app',
  'sdk/src/app',
  'sdk/src/platform-catalog',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.go', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['.git', '.next', '.turbo', '.vercel', 'build', 'coverage', 'dist', 'gen', 'generated', 'node_modules', 'out', 'target', 'tmp']);
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./, /\.fixture\./, /__fixtures__/, /__mocks__/];

// Forbidden product-kind admissions in app registry / client. The
// patterns target the literal admission syntax (yaml `kind:` field or
// SDK enum literal). Comments/strings that merely mention these names
// in descriptive prose are not flagged unless they take the admission
// shape.
const FORBIDDEN_PATTERNS = [
  /\bappKind\s*[:=]\s*['"]?(public-mod|publicMod|extension|public-extension)['"]?/i,
  /\bapp_kind\s*:\s*(public-mod|publicMod|extension|public-extension)/i,
  /\bkind\s*:\s*(public-mod|publicMod|extension|public-extension)\b/i,
  /admitted_app_kinds[\s\S]{0,200}\b(public-mod|extension)\b/i,
];

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const column = index - prefix.lastIndexOf('\n');
  return { line, column };
}

async function collectFiles(target) {
  const fullPath = path.join(repoRoot, target);
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    return [];
  }
  if (stat.isFile()) {
    if (!SOURCE_EXTENSIONS.has(path.extname(fullPath))) return [];
    return [fullPath];
  }
  const files = [];
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(fullPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path.relative(repoRoot, child)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE_PATTERNS.some(re => re.test(entry.name))) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(child);
  }
  return files;
}

async function collectViolations(files) {
  const violations = [];
  const thisFile = path.join(repoRoot, 'scripts', 'check-no-public-mod-extension-admission.mjs');
  for (const file of files) {
    if (file === thisFile) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(source);
      if (match) {
        const { line, column } = getLineColumn(source, match.index);
        const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
        violations.push(`${rel}:${line}:${column}: forbidden public mod/extension admission "${match[0]}"`);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-no-pub-mod-'));
  const negative = path.join(tempRoot, 'negative.yaml');
  const positive = path.join(tempRoot, 'positive.yaml');
  await fs.writeFile(negative, "rows:\n  - app_id: avatar\n    app_kind: nimi-app\n", 'utf8');
  await fs.writeFile(positive, "rows:\n  - app_id: rogue\n    app_kind: public-mod\n", 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) throw new Error(`self-test: negative flagged: ${neg.join(',')}`);
    const pos = await collectViolations([positive]);
    if (pos.length === 0) throw new Error('self-test: positive not flagged');
    process.stdout.write('check-no-public-mod-extension-admission self-test passed\n');
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
    files.push(...await collectFiles(target));
  }
  const violations = await collectViolations(files);
  if (violations.length > 0) {
    process.stderr.write('Public Mod and Extension product kinds are NOT admitted as Nimi Apps per P-NAPP-012 + P-MOEX-006.\n');
    for (const v of violations) process.stderr.write(`- ${v}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-no-public-mod-extension-admission passed (${files.length} file(s) scanned across ${TARGET_GLOBS.length} target(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-no-public-mod-extension-admission failed: ${String(error)}\n`);
  process.exitCode = 1;
});
