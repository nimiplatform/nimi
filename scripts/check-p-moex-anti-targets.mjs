#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const TARGETS = [
  '.nimi/spec',
  'apps/desktop',
  'apps/web',
  'docs',
  'runtime',
  'sdk/src',
  'sdk/test',
  'scripts',
  'package.json',
  'pnpm-workspace.yaml',
];

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.go',
  '.json',
  '.md',
  '.mjs',
  '.rs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const SKIP_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'archive',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'tmp',
]);

const ALLOWLIST = new Set([
  '.nimi/spec/platform/kernel/index.md',
  '.nimi/spec/platform/kernel/tables/rule-evidence.rules-nimi-app.yaml',
  '.nimi/spec/platform/kernel/mod-extension-retirement-contract.md',
  'scripts/check-platform-spec-kernel-consistency.mjs',
  'scripts/check-no-public-mod-extension-admission.mjs',
  'scripts/check-p-moex-anti-targets.mjs',
]);

const PATTERNS = [
  { id: 'field-mod-id', re: /\bmodId\b/gu },
  { id: 'caller-desktop-mod', re: /\bdesktop-mod\b/gu },
  { id: 'creator-mods-service', re: /\bCreatorMods\w*\b/gu },
  { id: 'canonical-mod-ai-scope', re: /\b\w*CanonicalModAIScopeRef\b/gu },
  { id: 'sdk-kind-mod', re: /\bkind\s*:\s*['"]mod['"]/gu },
  { id: 'runtime-mod-token', re: /\bruntime-mod\b/gu },
  { id: 'mod-hub-token', re: /\bmod-hub\b|\bModHub\b/gu },
  { id: 'mods-panel-token', re: /\bmods-panel\b|\bModsPanel\b/gu },
  { id: 'mod-workspace-token', re: /\bmod-workspace\b|\bModWorkspace\b/gu },
  { id: 'mod-codegen-token', re: /\bmod-codegen\b|\bModCodegen\b/gu },
  { id: 'mod-governance-token', re: /\bmod-governance\b|\bModGovernance\b/gu },
  { id: 'mod-extension-token', re: /\bmod-extension(?!-retirement)\b|\bModExtension\b/gu },
  { id: 'inter-mod-token', re: /\binter-mod\b|\bInterMod\b/gu },
  { id: 'hook-capability-token', re: /\bhook-capability\b|\bHookCapability\b/gu },
  { id: 'hook-allowlist-token', re: /\bhook-allowlist\b|\bHookAllowlist\b/gu },
  { id: 'turn-hook-points-token', re: /\bturn-hook-points\b|\bTurnHookPoints\b/gu },
  { id: 'mod-doc-url', re: /\/desktop\/mod-system/gu },
  { id: 'mods-url-path', re: /\/mods\//gu },
  { id: 'creator-mods-url', re: /\/creator[-_]mods\b|\/creator\/mods\b/gu },
  { id: 'mod-package-name', re: /@nimiplatform\/mod-[a-z0-9-]+/gu },
  { id: 'nimi-mod-token', re: /\bnimi-mod(?!e)[a-z0-9-]*\b/giu },
  { id: 'public-mod-token', re: /\bpublic-mod\b|\bPublic Mod\b/gu },
  { id: 'public-extension-token', re: /\bpublic-extension\b|\bPublic Extension\b/gu },
  { id: 'mod-prefixed-identifier', re: /\b(?:InvokeMod|RuntimeMod(?!e|ality|ule)|ModUI|ModSettings|ModCodegen|ModDeveloper|ModWorkspace)\w*\b/gu },
];

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const column = index - prefix.lastIndexOf('\n');
  return { line, column };
}

function relPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
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
      files.push(...await collectFiles(relPath(child)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(child);
  }
  return files;
}

async function collectViolations(files) {
  const violations = [];
  for (const file of files) {
    const rel = relPath(file);
    if (ALLOWLIST.has(rel)) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(source)) !== null) {
        const { line, column } = getLineColumn(source, match.index);
        violations.push(`${rel}:${line}:${column}: ${pattern.id}: ${match[0]}`);
        if (match[0].length === 0) pattern.re.lastIndex += 1;
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'p-moex-anti-targets-'));
  const negative = path.join(tempRoot, 'negative.ts');
  const positive = path.join(tempRoot, 'positive.ts');
  await fs.writeFile(negative, "export const appId = 'nimi.avatar';\n", 'utf8');
  await fs.writeFile(positive, "export const descriptor = { modId: 'core:local-ai', callerKind: 'desktop-mod' };\n", 'utf8');
  try {
    const neg = await collectViolations([negative]);
    if (neg.length !== 0) {
      throw new Error(`self-test negative sample flagged: ${neg.join(', ')}`);
    }
    const pos = await collectViolations([positive]);
    if (pos.length < 2) {
      throw new Error(`self-test positive sample under-detected: ${pos.join(', ')}`);
    }
    process.stdout.write('check-p-moex-anti-targets self-test passed\n');
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
  for (const target of TARGETS) {
    files.push(...await collectFiles(target));
  }
  const violations = await collectViolations(files);
  if (violations.length > 0) {
    process.stderr.write('P-MOEX anti-targets remain in active surfaces:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-p-moex-anti-targets passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-p-moex-anti-targets failed: ${String(error)}\n`);
  process.exitCode = 1;
});
