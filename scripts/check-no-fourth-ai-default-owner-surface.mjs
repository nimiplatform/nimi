#!/usr/bin/env node

// Structural mechanical gate: forbids any active fourth AI/default owner
// surface from re-emerging after the 2026-05-18 Nimi Home foundation
// correction. The canonical owner model is fixed to the three-tier
// `AIProfile` / `AIConfig` / `AISnapshot` chain plus the Platform
// `factory AIProfile catalog` and `AIProfile selection policy`
// (P-AIPS-001..P-AIPS-012). No additional product `default` /
// `home-experience-profile` / `first-run-profile-catalog` /
// `nimi-default-profile-catalog` owner surface may appear in active
// spec, runtime, sdk, desktop, scripts, or package.json.
//
// Skips closed-topic / Git-history references and topic-local audit
// artifacts which are evidence-only.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const TARGET_ROOTS = [
  '.nimi/spec',
  'runtime/internal',
  'runtime/cmd',
  'sdks/typescript',
  'apps/desktop/src',
  'scripts',
  'package.json',
];

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.vite',
  'build',
  'coverage',
  'dist',
  'gen',
  'generated',
  'node_modules',
  'out',
  'target',
  'tmp',
  '_archive',
  'archive',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.go',
  '.rs',
  '.md',
  '.yaml',
  '.yml',
  '.json',
]);

const SKIP_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\.fixture\./,
  /__fixtures__/,
];

// Owner-shaped aliases that would re-introduce a fourth AI/default
// truth even under a renamed banner. The list is intentionally narrow
// to catch product-owner names while ignoring topic-local audit
// vocabulary.
const FORBIDDEN_OWNER_PATTERNS = [
  /\bdefault[-_]experience[-_]profile\b/i,
  /\bDefaultExperienceProfile\b/,
  /\bDefaultExperienceBridge\b/,
  /\bhome[-_]experience[-_]profile\b/i,
  /\bHomeExperienceProfile\b/,
  /\bfirst[-_]run[-_]profile[-_]catalog\b/i,
  /\bFirstRunProfileCatalog\b/,
  /\bnimi[-_]default[-_]profile[-_]catalog\b/i,
  /\bNimiDefaultProfileCatalog\b/,
  /\bP-DXP-\d{3}\b/,
];

const SELF_FILE_NAME = 'check-no-fourth-ai-default-owner-surface.mjs';
const SIBLING_GATE_NAME = 'check-no-ai-profile-provider-model-constants.mjs';
const HOME_SHELL_GUARD_NAME = 'check-home-shell-no-runtime-internal-import.mjs';
// The replacement Platform authority contract file mentions the
// forbidden owner names by name inside its `MUST NOT` clauses; those
// are declarative anti-pattern callouts, not active owner surfaces.
const AUTHORITY_CONTRACT_FILE = '.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md';

function isTopicLifecycleArtifact(relative) {
  // `.nimi/topics/**` is human-authored topic lifecycle workspace; it
  // intentionally carries historical references to the retired vocabulary
  // as evidence. Skip it.
  return relative.startsWith('.nimi/topics/');
}

function isClosedTopicHistory(relative) {
  return relative.startsWith('.nimi/topics/closed/');
}

function isSelfFile(relative) {
  if (relative === `scripts/${SELF_FILE_NAME}`) return true;
  // Sibling gate script encodes the historical no-provider/no-model
  // pattern and references AIProfile vocabulary by name; it is not a
  // product-owner surface.
  if (relative === `scripts/${SIBLING_GATE_NAME}`) return true;
  return false;
}

function shouldSkipFile(relative) {
  if (isSelfFile(relative)) return true;
  if (isTopicLifecycleArtifact(relative)) return true;
  if (relative === AUTHORITY_CONTRACT_FILE) return true;
  return false;
}

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

async function collectFiles(root) {
  const absRoot = path.join(repoRoot, root);
  let stats;
  try {
    stats = await fs.stat(absRoot);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return [absRoot];
  }
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_FILE_PATTERNS.some((re) => re.test(entry.name))) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push(fullPath);
    }
  }
  await walk(absRoot);
  return files;
}

async function collectViolations(files) {
  const violations = [];
  for (const file of files) {
    const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');
    if (shouldSkipFile(relative)) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_OWNER_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(source);
      if (match) {
        const { line, column } = getLineColumn(source, match.index);
        violations.push(`${relative}:${line}:${column}: forbidden fourth-AI/default owner surface "${match[0]}"`);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'check-no-fourth-ai-default-'));
  const negativePath = path.join(tempRoot, 'negative.ts');
  const positivePaths = [
    { name: 'positive-default-experience.ts', body: "export const x = 'default-experience-profile';\n" },
    { name: 'positive-home-experience.ts', body: "export const x = 'home-experience-profile';\n" },
    { name: 'positive-first-run-catalog.ts', body: "export const x = 'first-run-profile-catalog';\n" },
    { name: 'positive-pdxp.md', body: '# heading\n\nReference: P-DXP-001 owner.\n' },
  ];

  await fs.writeFile(
    negativePath,
    [
      "import { applyAIProfileToConfig } from '@nimiplatform/sdk/ai';",
      "const owner = 'ai-profile-selection';",
      'await applyAIProfileToConfig(baseConfig, profile);',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const negativeViolations = await collectViolations([negativePath]);
    if (negativeViolations.length !== 0) {
      throw new Error(`self-test failed: negative fixture flagged: ${negativeViolations.join(', ')}`);
    }
    for (const positive of positivePaths) {
      const positivePath = path.join(tempRoot, positive.name);
      await fs.writeFile(positivePath, positive.body, 'utf8');
      const positiveViolations = await collectViolations([positivePath]);
      if (positiveViolations.length === 0) {
        throw new Error(`self-test failed: positive fixture ${positive.name} not flagged`);
      }
    }
    process.stdout.write('check-no-fourth-ai-default-owner-surface self-test passed\n');
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
  for (const root of TARGET_ROOTS) {
    files.push(...await collectFiles(root));
  }
  const violations = await collectViolations(files);
  if (violations.length > 0) {
    process.stderr.write('No active fourth AI/default owner surface is admitted after the 2026-05-18 foundation correction.\n');
    process.stderr.write('Reference: .nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md (P-AIPS-001, P-AIPS-008).\n');
    process.stderr.write('Only AIProfile / AIConfig / AISnapshot plus the Platform factory AIProfile catalog and AIProfile selection policy may own product default vocabulary.\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-no-fourth-ai-default-owner-surface passed (${files.length} file(s) scanned across ${TARGET_ROOTS.length} target root(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-no-fourth-ai-default-owner-surface failed: ${String(error)}\n`);
  process.exitCode = 1;
});
