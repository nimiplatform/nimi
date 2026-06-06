#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const rootDecisionGatePath = '.nimi/spec/sdks/kernel/tables/typescript-root-composition-decision-gate.yaml';

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

const EXPECTED_ROOT_OPTION = 'explicit-nimi-client-no-singleton';
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

function validateRootDecisionGate() {
  const gate = readYamlWithFragments(path.join(repoRoot, rootDecisionGatePath));
  const violations = [];
  const selectedOption = String(gate?.scope?.selected_option || '');
  const approvalStatus = String(gate?.scope?.approval_status || '');
  const options = Array.isArray(gate?.decision_options) ? gate.decision_options : [];
  const selected = options.find((option) => option?.id === EXPECTED_ROOT_OPTION);
  const selectedExports = Array.isArray(selected?.proposed_public_exports)
    ? selected.proposed_public_exports.map(String)
    : [];

  if (approvalStatus !== 'owner-approved') {
    violations.push(`${rootDecisionGatePath}: root composition approval_status must be owner-approved`);
  }
  if (selectedOption !== EXPECTED_ROOT_OPTION || selected?.status !== 'selected') {
    violations.push(`${rootDecisionGatePath}: selected_option must be ${EXPECTED_ROOT_OPTION}`);
  }
  for (const name of REQUIRED_VNEXT_ROOT_EXPORTS) {
    if (!selectedExports.includes(name)) {
      violations.push(`${rootDecisionGatePath}: selected vNext root exports must include ${name}`);
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
  const thisFile = path.join(repoRoot, 'scripts', 'check-no-create-nimi-client.mjs');
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

    process.stdout.write('check-no-create-nimi-client self-test passed\n');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const violations = validateRootDecisionGate();
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
  process.stderr.write(`check-no-create-nimi-client failed: ${String(error)}\n`);
  process.exitCode = 1;
});
