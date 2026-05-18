#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Per closed redesign `design.md` "No-Steam-Copy Negative Gates":
// Nimi must not copy Steam features as category justification. Forbidden
// product-copy language includes Workshop-as-mod-market, trading cards,
// achievement grind, Family Sharing clone, Big Picture mode, screenshot
// feed clone, friends-invite system clone.

// Product-copy / marketing / install-gateway surfaces only. The
// canonical anti-target rules in `.nimi/spec/platform/kernel/nimi-ecosystem-contract.md`
// legitimately document forbidden phrasing as rules and must not be
// scanned by this gate (they OWN the rule, not violate it).
const TARGET_GLOBS = [
  'apps/web/src',
  'apps/install-gateway/src',
  'apps/web/index.html',
  'apps/web/blueyard.html',
  'apps/web/privacy.html',
  'apps/web/terms.html',
  'apps/desktop/src/shell/renderer/locales',
];

const SOURCE_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.html', '.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'gen', 'generated']);
const SKIP_FILE_PATTERNS = [/\.test\./];

// Forbidden Steam-clone phrasing (product-copy level, NOT prose
// descriptions that mention Steam by name).
const FORBIDDEN_PATTERNS = [
  /\b(?:nimi[\w\s]*)?Workshop(?:\s+(?:clone|alternative|equivalent|replacement))\b/i,
  /\bSteam[-\s]?like\s+(?:Workshop|mod market|inventory|trading cards|achievements)\b/i,
  /\b(?:trading cards|achievement grind|collectible badges)\s+(?:as|to drive)\s+(?:retention|engagement)\b/i,
  /\bFamily Sharing\s+(?:clone|equivalent|replacement|alternative)\b/i,
  /\bBig Picture(?:\s+mode)?\s+(?:clone|equivalent|alternative)\b/i,
  /\bScreenshot(?:\s+feed)?\s+(?:clone|equivalent|alternative)\b/i,
  /\bFriends(?:\s+\/?\s*invite)?\s+system\s+(?:clone|equivalent|alternative)\b/i,
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
  const thisFile = path.join(repoRoot, 'scripts', 'check-no-steam-copy-language.mjs');
  for (const file of files) {
    if (file === thisFile) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(source);
      if (match) {
        const { line, column } = getLineColumn(source, match.index);
        const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
        violations.push(`${rel}:${line}:${column}: Steam-copy phrasing "${match[0]}"`);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-no-steam-'));
  const negative = path.join(tempRoot, 'negative.md');
  const positive = path.join(tempRoot, 'positive.md');
  await fs.writeFile(negative, '# Nimi App authority is account-scoped and permissioned through Runtime.\n', 'utf8');
  await fs.writeFile(positive, '# Nimi Workshop clone replicates Steam Workshop functionality.\n', 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) throw new Error(`self-test: negative flagged: ${neg.join(',')}`);
    const pos = await collectViolations([positive]);
    if (pos.length === 0) throw new Error('self-test: positive not flagged');
    process.stdout.write('check-no-steam-copy-language self-test passed\n');
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
    process.stderr.write('Steam-feature-clone language is forbidden per closed redesign "No-Steam-Copy Negative Gates".\n');
    for (const v of violations) process.stderr.write(`- ${v}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-no-steam-copy-language passed (${files.length} file(s) scanned across ${TARGET_GLOBS.length} target(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-no-steam-copy-language failed: ${String(error)}\n`);
  process.exitCode = 1;
});
