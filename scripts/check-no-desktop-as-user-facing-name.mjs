#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// User-facing shell renderer + product copy paths. Background framework
// modules that reference "Desktop" as the application bundle identifier
// are allowed (they're internal naming, not user-facing product copy).
const TARGET_GLOBS = [
  'apps/desktop/src/shell/renderer',
  'apps/web/src/shell',
  'apps/web/src/public',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html']);
const SKIP_DIRS = new Set(['.git', '.next', '.turbo', '.vercel', 'build', 'coverage', 'dist', 'gen', 'generated', 'node_modules', 'out', 'tmp']);
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./, /\.fixture\./, /__fixtures__/, /__mocks__/];

// Forbidden product-name usages of "Desktop". Patterns intentionally
// require title-case to avoid flagging descriptive lowercase usage like
// "the desktop runtime" (referring to the local Runtime component).
const FORBIDDEN_PATTERNS = [
  /\bNimi\s+Desktop\b/,
  /\bDesktop\s+App\b/,
  /\bDesktop\s+Application\b/,
  /\bThe\s+Desktop\s+(?:app|application|product|client|installer|build)\b/i,
  /\bOpen\s+Desktop\b/,
  /\bInstall\s+Desktop\b/,
  /\bDesktop\s+for\s+(?:Mac|Windows|Linux)\b/i,
];

const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;

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

function findViolations(text, source, file) {
  const violations = [];
  STRING_LITERAL.lastIndex = 0;
  let match;
  while ((match = STRING_LITERAL.exec(source)) !== null) {
    const literal = match[2];
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(literal)) {
        const { line, column } = getLineColumn(source, match.index);
        const truncated = literal.length > 120 ? literal.slice(0, 117) + '...' : literal;
        violations.push({ file, line, column, literal: truncated });
        break;
      }
    }
  }
  return violations;
}

async function collectViolations(files) {
  const violations = [];
  const thisFile = path.join(repoRoot, 'scripts', 'check-no-desktop-as-user-facing-name.mjs');
  for (const file of files) {
    if (file === thisFile) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const v of findViolations(source, source, file)) {
      const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
      violations.push(`${rel}:${v.line}:${v.column}: user-facing "Desktop" surface "${v.literal}"`);
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-no-desktop-userface-'));
  const negative = path.join(tempRoot, 'negative.tsx');
  const positive = path.join(tempRoot, 'positive.tsx');
  await fs.writeFile(negative, 'export const title = "Welcome to Nimi";\n', 'utf8');
  await fs.writeFile(positive, 'export const title = "Open Nimi Desktop";\n', 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) throw new Error('self-test failed: negative fixture flagged');
    const pos = await collectViolations([positive]);
    if (pos.length === 0) throw new Error('self-test failed: positive fixture not flagged');
    process.stdout.write('check-no-desktop-as-user-facing-name self-test passed\n');
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
    process.stderr.write('Desktop must not appear as user-facing product name. Nimi is the user-facing product per P-ARCH-001.\n');
    for (const v of violations) process.stderr.write(`- ${v}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-no-desktop-as-user-facing-name passed (${files.length} file(s) scanned across ${TARGET_GLOBS.length} target glob(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-no-desktop-as-user-facing-name failed: ${String(error)}\n`);
  process.exitCode = 1;
});
