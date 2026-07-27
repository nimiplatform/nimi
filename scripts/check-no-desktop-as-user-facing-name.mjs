#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// User-facing shell renderer + product copy paths. Background framework
// modules that reference "Desktop" as the application bundle identifier
// are allowed (they're internal naming, not user-facing product copy).
const TARGET_GLOBS = [
  'apps/desktop/src/shell/renderer',
  'apps/desktop/src-electron',
  'apps/web/src/desktop-adapter',
  'apps/web/src/landing',
  'apps/web/src/shell',
  'apps/web/src/public',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.json']);
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
  const scanned = shouldStripJsComments(file) ? stripJsComments(source) : source;
  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(scanned);
    if (match?.index !== undefined) {
      const { line, column } = getLineColumn(source, match.index);
      const start = Math.max(0, match.index - 60);
      const end = Math.min(source.length, match.index + 120);
      const excerpt = source.slice(start, end).replace(/\s+/g, ' ').trim();
      const truncated = excerpt.length > 120 ? excerpt.slice(0, 117) + '...' : excerpt;
      violations.push({ file, line, column, literal: truncated });
    }
  }
  return violations;
}

function shouldStripJsComments(file) {
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(path.extname(file));
}

function stripJsComments(source) {
  let result = '';
  let state = 'normal';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || '';
    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'normal';
        result += char;
      } else {
        result += ' ';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  ';
        index += 1;
        state = 'normal';
      } else {
        result += char === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      result += char;
      if (char === '\\') {
        result += next;
        index += 1;
        continue;
      }
      if (
        (state === 'single-quote' && char === "'")
        || (state === 'double-quote' && char === '"')
        || (state === 'template' && char === '`')
      ) {
        state = 'normal';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      result += '  ';
      index += 1;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      result += '  ';
      index += 1;
      state = 'block-comment';
      continue;
    }
    if (char === "'") state = 'single-quote';
    if (char === '"') state = 'double-quote';
    if (char === '`') state = 'template';
    result += char;
  }
  return result;
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

async function main() {
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
