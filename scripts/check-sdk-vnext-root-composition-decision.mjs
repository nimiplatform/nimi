#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gatePath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'sdks',
  'kernel',
  'tables',
  'typescript-root-composition-decision-gate.yaml',
);
const ledgerPath = path.join(
  repoRoot,
  'config',
  'sdk-vnext-migration',
  'typescript-replacement-coverage-ledger.yaml',
);
const inventoryPath = path.join(
  repoRoot,
  'config',
  'sdk-vnext-migration',
  'typescript-app-adaptation-inventory.yaml',
);
const ROOT_SURFACE = '@nimiplatform/sdk';
const EXPECTED_PROTOCOL = 'sdks_typescript_root_composition_decision_gate';
const EXPECTED_RECOMMENDATION = 'explicit-nimi-client-no-singleton';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'target', 'coverage', '.tmp', '.next', '.turbo', '.svelte-kit']);
const IMPORT_PATTERN = /(?:from\s+['"]|import\(['"]|require\(['"])(@nimiplatform\/sdk(?:\/[A-Za-z0-9_.\/-]+)?)/gu;

function readYaml(filePath) {
  return YAML.parse(readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function existsRelative(relativePath) {
  return existsSync(path.join(repoRoot, relativePath));
}

function walkFiles(root, output = []) {
  const absoluteRoot = path.join(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    return output;
  }
  for (const entry of readdirSync(absoluteRoot)) {
    if (SKIP_DIRS.has(entry)) continue;
    const absolutePath = path.join(absoluteRoot, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walkFiles(relative(absolutePath), output);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(absolutePath))) {
      output.push(relative(absolutePath));
    }
  }
  return output;
}

function scanRootImports(sourceRoot) {
  let count = 0;
  for (const file of walkFiles(sourceRoot)) {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      if (match[1] === ROOT_SURFACE) {
        count += 1;
      }
    }
  }
  return count;
}

function findSurface(rows, id) {
  return (Array.isArray(rows) ? rows : []).find((row) => row?.id === id);
}

function main() {
  const violations = [];
  const warnings = [];
  if (!existsSync(gatePath)) {
    throw new Error(`missing root decision gate: ${relative(gatePath)}`);
  }
  const gate = readYaml(gatePath);
  const ledger = readYaml(ledgerPath);
  const inventory = readYaml(inventoryPath);

  if (gate?.protocol_id !== EXPECTED_PROTOCOL) {
    violations.push(`root decision gate must use protocol_id ${EXPECTED_PROTOCOL}`);
  }
  if (gate?.scope?.approval_status !== 'owner-approved') {
    violations.push('root decision gate scope.approval_status must be owner-approved after owner selects root API');
  }
  if (gate?.scope?.selected_option !== EXPECTED_RECOMMENDATION) {
    violations.push(`root decision gate scope.selected_option must be ${EXPECTED_RECOMMENDATION}`);
  }
  if (gate?.scope?.verification_gate !== 'check:sdk-vnext-root-composition-decision') {
    violations.push('root decision gate scope.verification_gate must be check:sdk-vnext-root-composition-decision');
  }
  if (gate?.required_decision?.recommendation !== EXPECTED_RECOMMENDATION) {
    violations.push(`root decision gate recommendation must be ${EXPECTED_RECOMMENDATION}`);
  }

  const options = Array.isArray(gate?.decision_options) ? gate.decision_options : [];
  const recommended = options.filter((option) => option?.recommendation === true);
  if (recommended.length !== 1 || recommended[0]?.id !== EXPECTED_RECOMMENDATION || recommended[0]?.status !== 'selected') {
    violations.push('root decision gate must record exactly one selected explicit no-singleton option');
  }
  for (const rejected of ['keep-platform-client-singleton', 'root-reexports-only']) {
    const option = options.find((item) => item?.id === rejected);
    if (!option || option.status !== 'rejected' || !String(option.rejected_reason ?? '').trim()) {
      violations.push(`root decision gate must explicitly reject ${rejected} with a reason`);
    }
  }

  const forbiddenExports = Array.isArray(gate?.forbidden_retired_exports) ? gate.forbidden_retired_exports.map(String) : [];
  const rootIndex = readFileSync(path.join(repoRoot, 'sdks', 'typescript', 'index.ts'), 'utf8');
  for (const name of ['createNimiClient', 'NimiClient', 'NimiClientConfig']) {
    if (!rootIndex.includes(name) && !rootIndex.includes("export * from './root-client'")) {
      violations.push(`sdks/typescript root must export vNext root composition symbol ${name}`);
    }
  }
  if (!existsRelative('sdks/typescript/root-client.ts')) {
    violations.push('sdks/typescript root composition source missing: sdks/typescript/root-client.ts');
  }
  for (const name of forbiddenExports) {
    if (rootIndex.includes(name)) {
      violations.push(`sdks/typescript root must not export retired root symbol ${name}`);
    }
  }

  const rootSurface = findSurface(ledger?.surfaces, 'root-platform-composition');
  if (!rootSurface) {
    violations.push('Replacement coverage replacement ledger missing root-platform-composition row');
  } else {
    if (rootSurface.replacement_status !== 'implemented') {
      violations.push('root-platform-composition replacement_status must be implemented after owner selects root API and root client lands');
    }
    if (rootSurface.acceptance_blocker !== false) {
      violations.push('root-platform-composition must not remain an acceptance blocker after root client implementation');
    }
    const gates = Array.isArray(rootSurface.verification_gates) ? rootSurface.verification_gates.map(String) : [];
    if (!gates.includes('check:sdk-vnext-root-composition-decision')) {
      violations.push('root-platform-composition must include check:sdk-vnext-root-composition-decision');
    }
    if (!gates.includes('check:sdk-vnext-root-consumer-smoke')) {
      violations.push('root-platform-composition must include check:sdk-vnext-root-consumer-smoke');
    }
  }

  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  let total = 0;
  for (const entry of entries) {
    if (entry?.id === 'migration-proofs') continue;
    const sourceRoot = String(entry?.source_root ?? '');
    const actual = scanRootImports(sourceRoot);
    total += actual;
  }

  warnings.push('root composition API owner decision selected; root implementation and first-party migration gates are active');
  for (const warning of warnings) {
    process.stdout.write(`[check-sdk-vnext-root-composition-decision] ${warning}\n`);
  }
  if (violations.length > 0) {
    process.stderr.write('SDK vNext root composition decision check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `SDK vNext root composition decision check passed ` +
      `(root_import_refs=${total}, selected=${EXPECTED_RECOMMENDATION}, status=implemented)\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-root-composition-decision failed: ${message}\n`);
  process.exitCode = 1;
}
