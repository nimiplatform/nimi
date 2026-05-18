#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Per Wave 6 close-requires + closed-redesign first-party hardcut:
// existing ordinary-user standalone entry points for Avatar / ParentOS
// must be removed, blocked, or converted to developer-only paths with
// clear failure projection.
//
// This gate scans Tauri config + first-party app entrypoint manifests
// for any ordinary-user posture standalone entry that isn't explicitly
// marked developer-only.

const TARGET_GLOBS = [
  'apps/avatar/src-tauri',
  'apps/parentos/src-tauri',
];

const SOURCE_EXTENSIONS = new Set(['.json', '.json5', '.toml', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'gen', 'build', 'dist']);
const SKIP_FILE_PATTERNS = [/\.test\./];

// Forbidden patterns: ordinary-user standalone entry that lacks
// developer-only marking.
const ORDINARY_USER_ENTRY_PATTERN = /["']?standalone[_-]?entry["']?\s*[:=]\s*["']?ordinary[-_]user["']?/i;
const PUBLISHED_PRODUCT_PATTERN  = /["']?published[_-]?as[_-]?product["']?\s*[:=]\s*["']?(true|primary)["']?/i;
const DEVELOPER_ONLY_MARKER      = /["']?developer[_-]?only["']?\s*[:=]\s*["']?true["']?/i;

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
  const thisFile = path.join(repoRoot, 'scripts', 'check-first-party-no-standalone-ordinary-user-entry.mjs');
  for (const file of files) {
    if (file === thisFile) continue;
    const source = await fs.readFile(file, 'utf8');
    const hasDeveloperOnlyMarker = DEVELOPER_ONLY_MARKER.test(source);
    const offenders = [];
    ORDINARY_USER_ENTRY_PATTERN.lastIndex = 0;
    const ordinaryEntryMatch = ORDINARY_USER_ENTRY_PATTERN.exec(source);
    if (ordinaryEntryMatch && !hasDeveloperOnlyMarker) {
      const { line, column } = getLineColumn(source, ordinaryEntryMatch.index);
      offenders.push(`${line}:${column}: standalone_entry: ordinary-user without developer-only marker`);
    }
    PUBLISHED_PRODUCT_PATTERN.lastIndex = 0;
    const publishedMatch = PUBLISHED_PRODUCT_PATTERN.exec(source);
    if (publishedMatch && !hasDeveloperOnlyMarker) {
      const { line, column } = getLineColumn(source, publishedMatch.index);
      offenders.push(`${line}:${column}: published_as_product without developer-only marker`);
    }
    for (const offender of offenders) {
      const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
      violations.push(`${rel}:${offender}`);
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-fp-standalone-'));
  const negative = path.join(tempRoot, 'negative.json');
  const positive = path.join(tempRoot, 'positive.json');
  const developerOnly = path.join(tempRoot, 'developer-only.json');
  await fs.writeFile(negative, JSON.stringify({ standalone_entry: 'nimi-app' }), 'utf8');
  await fs.writeFile(positive, JSON.stringify({ standalone_entry: 'ordinary-user' }), 'utf8');
  await fs.writeFile(developerOnly, JSON.stringify({ standalone_entry: 'ordinary-user', developer_only: true }), 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) throw new Error(`self-test: negative flagged: ${neg.join(',')}`);
    const pos = await collectViolations([positive]);
    if (pos.length === 0) throw new Error('self-test: positive not flagged');
    const devOk = await collectViolations([developerOnly]);
    if (devOk.length !== 0) throw new Error('self-test: developer-only marker should suppress: ' + devOk.join(','));
    process.stdout.write('check-first-party-no-standalone-ordinary-user-entry self-test passed\n');
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
    process.stderr.write('First-party app Tauri/config must NOT carry ordinary-user standalone entry per Wave 6 hardcut. Mark explicitly developer_only:true or remove.\n');
    for (const v of violations) process.stderr.write(`- ${v}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-first-party-no-standalone-ordinary-user-entry passed (${files.length} file(s) scanned across ${TARGET_GLOBS.length} target glob(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-first-party-no-standalone-ordinary-user-entry failed: ${String(error)}\n`);
  process.exitCode = 1;
});
