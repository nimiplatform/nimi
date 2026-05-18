#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Per closed redesign `web-entry-boundary.md` and Platform
// nimi-package-release-contract.md: web + install-gateway surfaces are
// release-handoff-only. They MUST NOT claim:
// - self-update authority (Platform owns)
// - Runtime materialization authority (Runtime owns)
// - Nimi App admission authority (Platform/Wave 4 registry owns)
// - Nimi Home shell IA truth (Desktop Home shell owns)

const TARGET_GLOBS = [
  'apps/install-gateway/src',
  'apps/install-gateway/scripts',
  'apps/web/src',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['.git', '.next', '.turbo', '.vercel', 'build', 'coverage', 'dist', 'gen', 'generated', 'node_modules', 'out', 'tmp']);
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./];

// Forbidden authority-claim patterns. Each pattern indicates code that
// claims authority install-gateway/web are not permitted to own.
const FORBIDDEN_PATTERNS = [
  // Self-update authority claims
  /\bselfUpdate\s*[:=]\s*\{?\s*['"]?(initiate|approve|trigger|grant)['"]?/i,
  /\bself_update_authority\s*[:=]\s*(true|owned|primary)/i,
  // Runtime materialization claims
  /\bmaterializeArtifact\s*\(/,
  /\bruntimeMaterializer\s*\(/,
  /\binstall(?:Engine|Model|Pack|Dependency)\s*\(/,
  // App admission claims
  /\badmitApp\s*\(/,
  /\bregistry\.admit\s*\(/,
  /\bappKindAdmission\s*[:=]/,
  // Home shell IA claims
  /\bnimiHomeShellTruth\b/,
  /\bhomeShellPrimaryOwner\b/,
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

async function collectViolations(files) {
  const violations = [];
  const thisFile = path.join(repoRoot, 'scripts', 'check-install-gateway-no-admission-authority.mjs');
  for (const file of files) {
    if (file === thisFile) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(source);
      if (match) {
        const { line, column } = getLineColumn(source, match.index);
        const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
        violations.push(`${rel}:${line}:${column}: forbidden admission/materialization/self-update authority claim "${match[0]}"`);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-installgw-'));
  const negative = path.join(tempRoot, 'negative.ts');
  const positive = path.join(tempRoot, 'positive.ts');
  await fs.writeFile(negative, "export async function handoff(url: string) {\n  await fetch(url);\n}\n", 'utf8');
  await fs.writeFile(positive, "export async function rogue() {\n  await admitApp({ appId: 'rogue' });\n}\n", 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) throw new Error(`self-test: negative flagged: ${neg.join(',')}`);
    const pos = await collectViolations([positive]);
    if (pos.length === 0) throw new Error('self-test: positive not flagged');
    process.stdout.write('check-install-gateway-no-admission-authority self-test passed\n');
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
    process.stderr.write('Install-gateway + web surfaces must NOT claim self-update, Runtime materialization, app admission, or Home shell authority (per web-entry-boundary.md + nimi-package-release-contract.md).\n');
    for (const v of violations) process.stderr.write(`- ${v}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-install-gateway-no-admission-authority passed (${files.length} file(s) scanned across ${TARGET_GLOBS.length} target glob(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-install-gateway-no-admission-authority failed: ${String(error)}\n`);
  process.exitCode = 1;
});
