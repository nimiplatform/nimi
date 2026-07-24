#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SOURCE_ROOTS = ['sdks/typescript', 'apps', 'examples'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.tmp',
  '.turbo',
  '.vercel',
  '.vite',
  'build',
  'coverage',
  'dist',
  'generated',
  'gen',
  'node_modules',
  'out',
  'test',
  'tests',
  'tmp',
]);

const SKIP_FILE_PATTERNS = [
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
  /\.d\.ts$/,
];

// Owner-approved vNext root composition: explicit-nimi-client-no-singleton.
// The former decision-gate table was process configuration; the product
// boundary itself (required root exports, forbidden legacy singleton symbols)
// is asserted directly here.
const SDK_ROOT_ENTRY = 'sdks/typescript/index.ts';
const SDK_ROOT_CLIENT = 'sdks/typescript/root-client.ts';
const REQUIRED_VNEXT_ROOT_EXPORTS = ['createNimiClient', 'NimiClient', 'NimiClientConfig'];
const FORBIDDEN_LEGACY_ROOT_SYMBOLS = [
  'createPlatformClient',
  'createLocalFirstPartyRuntimePlatformClient',
  'getPlatformClient',
  'clearPlatformClient',
  'unstable_attachPlatformWorldEvolutionSelectorReadProvider',
  'createNimiAppRuntimePlatformClient',
];

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

function symbolPattern(symbol) {
  return new RegExp(`\\b${symbol}\\b`, 'g');
}

async function validateRootEntryExports() {
  const violations = [];
  let entrySource;
  try {
    entrySource = await fs.readFile(path.join(repoRoot, SDK_ROOT_ENTRY), 'utf8');
  } catch {
    return [`${SDK_ROOT_ENTRY}: SDK root entry is missing`];
  }
  if (!entrySource.includes("'./root-client'")) {
    violations.push(`${SDK_ROOT_ENTRY}: vNext root entry must re-export ./root-client`);
  }
  let clientSource;
  try {
    clientSource = await fs.readFile(path.join(repoRoot, SDK_ROOT_CLIENT), 'utf8');
  } catch {
    return [...violations, `${SDK_ROOT_CLIENT}: vNext root client module is missing`];
  }
  for (const name of REQUIRED_VNEXT_ROOT_EXPORTS) {
    if (!symbolPattern(name).test(clientSource)) {
      violations.push(`${SDK_ROOT_CLIENT}: vNext root composition must expose ${name}`);
    }
  }
  return violations;
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
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    if (SKIP_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

async function collectLegacyRootViolations(files) {
  const violations = [];
  const thisFile = path.join(repoRoot, 'scripts', 'check-sdk-root-entry-contract.mjs');
  for (const file of files) {
    if (file === thisFile) {
      continue;
    }
    const source = await fs.readFile(file, 'utf8');
    for (const symbol of FORBIDDEN_LEGACY_ROOT_SYMBOLS) {
      const pattern = symbolPattern(symbol);
      let match = pattern.exec(source);
      while (match) {
        const { line, column } = getLineColumn(source, match.index);
        const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');
        violations.push(`${relative}:${line}:${column} contains forbidden legacy root symbol ${symbol}`);
        match = pattern.exec(source);
      }
    }
  }
  return violations;
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-check-root-client-'));
  const vnextPath = path.join(tempRoot, 'vnext.ts');
  const legacyPath = path.join(tempRoot, 'legacy.ts');

  await fs.writeFile(
    vnextPath,
    "import { createNimiClient } from '@nimiplatform/sdk';\nconst client = createNimiClient({});\nvoid client;\n",
    'utf8',
  );
  await fs.writeFile(
    legacyPath,
    "import { createPlatformClient } from '@nimiplatform/sdk';\nconst client = createPlatformClient();\nvoid client;\n",
    'utf8',
  );

  try {
    const vnextViolations = await collectLegacyRootViolations([vnextPath]);
    if (vnextViolations.length !== 0) {
      throw new Error('self-test failed: owner-approved vNext root factory was flagged');
    }

    const legacyViolations = await collectLegacyRootViolations([legacyPath]);
    if (legacyViolations.length === 0) {
      throw new Error('self-test failed: legacy platform-client fixture was not flagged');
    }

    process.stdout.write('check-sdk-root-entry-contract self-test passed\n');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const violations = await validateRootEntryExports();
  const files = [];
  for (const root of SOURCE_ROOTS) {
    files.push(...await collectFiles(path.join(repoRoot, root)));
  }
  violations.push(...await collectLegacyRootViolations(files));

  if (violations.length > 0) {
    process.stderr.write('vNext root composition guard failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('vNext root composition guard passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-sdk-root-entry-contract failed: ${String(error)}\n`);
  process.exitCode = 1;
});
