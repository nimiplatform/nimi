#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SOURCE_ROOTS = [
  'apps/desktop/src/runtime/llm-adapter',
  'apps/desktop/src/shell/renderer/features/runtime-config/domain/provider-connectors',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

const BANNED_PATTERNS = [
  {
    label: 'legacy adapter factory',
    regex: /\bcreateProviderAdapter\s*\(/g,
  },
  {
    label: 'direct adapter listModels invocation',
    regex: /\.[ \t]*listModels\s*\(/g,
  },
  {
    label: 'direct adapter healthCheck invocation',
    regex: /\.[ \t]*healthCheck\s*\(/g,
  },
];

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

async function collectSourceFiles(dir) {
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
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(fullPath);
  }

  return files;
}

async function collectViolations(files) {
  const violations = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const rel = toRepoRelative(file);

    for (const { label, regex } of BANNED_PATTERNS) {
      regex.lastIndex = 0;
      let match = regex.exec(source);
      while (match) {
        const { line, column } = getLineColumn(source, match.index);
        violations.push(`${rel}:${line}:${column} ${label}`);
        match = regex.exec(source);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-check-token-api-'));
  const goodPath = path.join(tempRoot, 'good.ts');
  const badPath = path.join(tempRoot, 'bad.ts');
  await fs.writeFile(
    goodPath,
    "export const route = async () => ({ source: 'token-api' as const });\n",
    'utf8',
  );
  await fs.writeFile(
    badPath,
    "import { createProviderAdapter } from './legacy';\nconst x = createProviderAdapter();\n",
    'utf8',
  );

  try {
    const goodViolations = await collectViolations([goodPath]);
    if (goodViolations.length !== 0) {
      throw new Error('self-test failed: clean fixture was flagged');
    }
    const badViolations = await collectViolations([badPath]);
    if (badViolations.length === 0) {
      throw new Error('self-test failed: legacy fixture was not flagged');
    }
    process.stdout.write('check-desktop-token-api-runtime-only self-test passed\n');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const roots = SOURCE_ROOTS.map((rel) => ({
    rel,
    abs: path.join(repoRoot, rel),
  }));

  const missingRoots = roots.filter((root) => !path.isAbsolute(root.abs) || !root.abs.startsWith(repoRoot) || !root.abs.includes('/apps/desktop/'));
  if (missingRoots.length > 0) {
    process.stderr.write('desktop token-api runtime-only check misconfigured: invalid scan root(s)\n');
    for (const root of missingRoots) {
      process.stderr.write(`- ${root.rel}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const files = [];
  for (const root of roots) {
    files.push(...await collectSourceFiles(root.abs));
  }

  if (files.length === 0) {
    process.stderr.write('desktop token-api runtime-only check failed: no source files found under scan roots\n');
    process.exitCode = 1;
    return;
  }
  const violations = await collectViolations(files);

  if (violations.length > 0) {
    process.stderr.write('desktop token-api runtime-only check failed\n');
    process.stderr.write('token-api path must be routed through runtime connector APIs only\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`desktop token-api runtime-only check passed (${files.length} files scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-desktop-token-api-runtime-only failed: ${String(error)}\n`);
  process.exitCode = 1;
});
