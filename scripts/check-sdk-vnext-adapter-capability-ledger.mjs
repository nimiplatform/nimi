#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { isSdkDistPrepared, withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');
const ledgerPath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'sdks',
  'kernel',
  'tables',
  'typescript-adapter-capability-ledger.yaml',
);
const sourceRootsPath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'sdks',
  'kernel',
  'tables',
  'adapter-source-roots.yaml',
);

const LEVEL_ORDER = new Map([
  ['L0', 0],
  ['L1', 1],
  ['L2', 2],
  ['L3', 3],
  ['L4', 4],
  ['L5', 5],
]);
const VALID_STATUSES = new Set(['implemented', 'deferred', 'blocked']);
const VALID_CAPABILITY_SUPPORTS = new Set(['supported', 'partial', 'unsupported', 'not-applicable']);
const VALID_CAPABILITY_MODES = new Set([
  'adapter-mapped',
  'framework-owned',
  'runtime-owned',
  'sdk-feature-owned',
  'caller-owned',
  'owner-gated',
  'governance-only',
  'out-of-domain',
]);

const REQUIRED_ADAPTER_IDS = [
  'vercel-ai',
  'openai-compatible',
  'mcp',
  'mastra',
  'langgraph',
  'llamaindex',
  'react',
  'next',
];

function readYaml(filePath) {
  return YAML.parse(readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function existsRelative(relativePath) {
  return existsSync(path.join(repoRoot, relativePath));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasManifestCapability(manifestText, capability, support, mode) {
  const quoted = `['"]${escapeRegex(capability)}['"]`;
  const bare = /^[A-Za-z_$][\w$]*$/u.test(capability)
    ? `\\b${escapeRegex(capability)}\\b`
    : null;
  const keyPattern = bare ? `(?:${quoted}|${bare})` : quoted;
  return new RegExp(
    `${keyPattern}\\s*:\\s*\\{[\\s\\S]*?\\bsupport\\s*:\\s*['"]${escapeRegex(support)}['"][\\s\\S]*?\\bmode\\s*:\\s*['"]${escapeRegex(mode)}['"][\\s\\S]*?\\}`,
    'u',
  ).test(manifestText);
}

function hasScalar(manifestText, key, value) {
  return new RegExp(`\\b${escapeRegex(key)}\\s*:\\s*['"]${escapeRegex(value)}['"]`, 'u').test(manifestText);
}

function validateStringSet(violations, label, actualValues, expectedValues) {
  const actual = new Set(Array.isArray(actualValues) ? actualValues.map((value) => String(value)) : []);
  for (const expected of expectedValues) {
    if (!actual.has(expected)) {
      violations.push(`${label} missing ${expected}`);
    }
  }
  for (const value of actual) {
    if (!expectedValues.has(value)) {
      violations.push(`${label} has invalid value ${value}`);
    }
  }
}

function runCommand(label, args) {
  process.stdout.write(`[check-sdk-vnext-adapter-capability-ledger] ${label}\n`);
  const result = spawnSync(args[0], args.slice(1), {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const code = result.status ?? 1;
    throw new Error(`${label} failed with exit code ${String(code)}`);
  }
}

function validateLedger() {
  const violations = [];
  if (!existsSync(ledgerPath)) {
    throw new Error(`missing ledger: ${relative(ledgerPath)}`);
  }
  const ledger = readYaml(ledgerPath);
  const sourceRoots = readYaml(sourceRootsPath);

  if (ledger?.protocol_id !== 'sdks_typescript_adapter_capability_ledger') {
    violations.push('ledger must use protocol_id sdks_typescript_adapter_capability_ledger');
  }
  if (ledger?.owner !== 'sdks') {
    violations.push('ledger owner must be sdks');
  }
  if (ledger?.scope?.target_root !== 'sdks/typescript/adapters') {
    violations.push('ledger scope.target_root must be sdks/typescript/adapters');
  }
  validateStringSet(
    violations,
    'ledger capability_support_values',
    ledger?.capability_support_values,
    VALID_CAPABILITY_SUPPORTS,
  );
  validateStringSet(
    violations,
    'ledger capability_mode_values',
    ledger?.capability_mode_values,
    VALID_CAPABILITY_MODES,
  );

  const rootRows = Array.isArray(sourceRoots?.entries) ? sourceRoots.entries : [];
  const sourceRootById = new Map(rootRows.map((row) => [String(row.id), String(row.owner)]));
  const adapters = Array.isArray(ledger?.surfaces) ? ledger.surfaces : [];
  const adaptersById = new Map();

  for (const adapter of adapters) {
    const id = String(adapter?.id ?? '');
    if (!id) {
      violations.push('adapter row missing id');
      continue;
    }
    if (adaptersById.has(id)) {
      violations.push(`duplicate adapter row ${id}`);
    }
    adaptersById.set(id, adapter);
  }

  for (const id of REQUIRED_ADAPTER_IDS) {
    if (!sourceRootById.has(id)) {
      violations.push(`adapter-source-roots missing required adapter ${id}`);
    }
    if (!adaptersById.has(id)) {
      violations.push(`ledger missing required adapter ${id}`);
    }
  }

  for (const [id, adapter] of adaptersById) {
    const expectedRoot = sourceRootById.get(id);
    const sourceRoot = String(adapter?.source_root ?? '');
    if (sourceRoot !== expectedRoot) {
      violations.push(`adapter ${id} source_root must be ${expectedRoot}, got ${sourceRoot}`);
    }
    for (const field of ['minimum_capability_level', 'implementation_level', 'release_target_level']) {
      if (!LEVEL_ORDER.has(String(adapter?.[field] ?? ''))) {
        violations.push(`adapter ${id} has invalid ${field}: ${String(adapter?.[field] ?? '')}`);
      }
    }
    const floor = LEVEL_ORDER.get(String(adapter?.minimum_capability_level ?? '')) ?? 99;
    const implemented = LEVEL_ORDER.get(String(adapter?.implementation_level ?? '')) ?? -1;
    if (implemented < floor) {
      violations.push(`adapter ${id} implementation_level must meet minimum_capability_level`);
    }
    if (!VALID_STATUSES.has(String(adapter?.implementation_status ?? ''))) {
      violations.push(`adapter ${id} has invalid implementation_status ${String(adapter?.implementation_status ?? '')}`);
    }
    if (adapter?.unsupported_behavior !== 'throw') {
      violations.push(`adapter ${id} must use unsupported_behavior throw`);
    }
    if (!String(adapter?.production_core_binding ?? '').trim()) {
      violations.push(`adapter ${id} must record production_core_binding`);
    }

    const sourceFiles = [
      `${sourceRoot}/index.ts`,
      String(adapter?.manifest ?? ''),
      String(adapter?.test ?? ''),
      String(adapter?.example ?? ''),
    ];
    for (const sourceFile of sourceFiles) {
      if (!sourceFile || !existsRelative(sourceFile)) {
        violations.push(`adapter ${id} missing required source file ${sourceFile}`);
      }
    }

    const manifestPath = String(adapter?.manifest ?? '');
    const manifestText = manifestPath && existsRelative(manifestPath)
      ? readFileSync(path.join(repoRoot, manifestPath), 'utf8')
      : '';
    if (manifestText) {
      if (!hasScalar(manifestText, 'capabilityLevel', String(adapter?.implementation_level ?? ''))) {
        violations.push(`adapter ${id} manifest capabilityLevel must match implementation_level ${String(adapter?.implementation_level ?? '')}`);
      }
      if (!hasScalar(manifestText, 'unsupportedBehavior', String(adapter?.unsupported_behavior ?? ''))) {
        violations.push(`adapter ${id} manifest unsupportedBehavior must match ledger`);
      }
      const claims = Array.isArray(adapter?.capability_claims) ? adapter.capability_claims : [];
      if (claims.length === 0) {
        violations.push(`adapter ${id} must list capability_claims`);
      }
      for (const claim of claims) {
        const capability = String(claim?.capability ?? '');
        const support = String(claim?.support ?? '');
        const mode = String(claim?.mode ?? '');
        if (!capability) {
          violations.push(`adapter ${id} has capability claim without capability`);
          continue;
        }
        if (!VALID_CAPABILITY_SUPPORTS.has(support)) {
          violations.push(`adapter ${id} capability ${capability} has invalid support ${support}`);
          continue;
        }
        if (!VALID_CAPABILITY_MODES.has(mode)) {
          violations.push(`adapter ${id} capability ${capability} has invalid mode ${mode}`);
          continue;
        }
        if (!hasManifestCapability(manifestText, capability, support, mode)) {
          violations.push(`adapter ${id} manifest does not declare ${capability}: ${support}/${mode}`);
        }
      }
    }

    const testText = existsRelative(String(adapter?.test ?? ''))
      ? readFileSync(path.join(repoRoot, String(adapter.test)), 'utf8')
      : '';
    if (!testText.includes('unsupported') && !testText.includes('Unsupported')) {
      violations.push(`adapter ${id} test must cover unsupported behavior`);
    }
  }

  const vercel = adaptersById.get('vercel-ai');
  if (vercel) {
    const vercelManifest = readFileSync(path.join(repoRoot, String(vercel.manifest)), 'utf8');
    for (const frameworkOwnedClaim of ['multiStep', 'tools.execute']) {
      if (!hasManifestCapability(vercelManifest, frameworkOwnedClaim, 'supported', 'framework-owned')) {
        violations.push(`vercel-ai must claim ${frameworkOwnedClaim} as supported/framework-owned`);
      }
    }
    for (const adapterMappedClaim of [
      'tools.providerDefined',
      'tools.providerExecuted',
      'tools.providerToolResults',
      'tools.providerApproval',
      'deferredResults',
      'sources',
      'rawChunks',
    ]) {
      if (!hasManifestCapability(vercelManifest, adapterMappedClaim, 'supported', 'adapter-mapped')) {
        violations.push(`vercel-ai must claim ${adapterMappedClaim} as supported/adapter-mapped`);
      }
    }
    for (const notApplicableClaim of ['tools.adapterExecute', 'externalExecution']) {
      if (!hasManifestCapability(vercelManifest, notApplicableClaim, 'not-applicable', 'framework-owned')) {
        violations.push(`vercel-ai must keep ${notApplicableClaim} not-applicable/framework-owned`);
      }
    }
    if (
      String(vercel.release_target_level) === 'L3'
      && String(vercel.release_target_status) !== 'implemented'
      && !String(vercel.release_blocker ?? '').trim()
    ) {
      violations.push('vercel-ai non-implemented L3 release target must record release_blocker');
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SDK vNext adapter capability ledger check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exit(1);
  }

  return adapters;
}

async function main() {
  const adapters = validateLedger();
  const testFiles = adapters.map((adapter) => (
    path.relative(vnextRoot, path.join(repoRoot, String(adapter.test))).replaceAll(path.sep, '/')
  ));
  const typecheckFiles = adapters.flatMap((adapter) => [
    path.relative(vnextRoot, path.join(repoRoot, String(adapter.source_root), 'index.ts')).replaceAll(path.sep, '/'),
    path.relative(vnextRoot, path.join(repoRoot, String(adapter.manifest))).replaceAll(path.sep, '/'),
    path.relative(vnextRoot, path.join(repoRoot, String(adapter.example))).replaceAll(path.sep, '/'),
    path.relative(vnextRoot, path.join(repoRoot, String(adapter.test))).replaceAll(path.sep, '/'),
  ]);

  await withSdkDistLock('check-sdk-vnext-adapter-capability-ledger build+test+typecheck', async () => {
    if (!isSdkDistPrepared()) {
      runCommand('building vNext SDK package for adapter workspace resolution', [
        'pnpm',
        '--filter',
        '@nimiplatform/sdk',
        'build',
      ]);
    }
    runCommand('running adapter tests', [
      'pnpm',
      '--dir',
      vnextRoot,
      'exec',
      'tsx',
      '--test',
      '--test-concurrency=1',
      ...testFiles,
    ]);
    runCommand('typechecking adapter sources, examples, and tests', [
      'pnpm',
      '--dir',
      vnextRoot,
      'exec',
      'tsc',
      '--noEmit',
      '--target',
      'ES2022',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--strict',
      '--types',
      'node',
      '--skipLibCheck',
      ...typecheckFiles,
    ]);
  });

  process.stdout.write(
    `SDK vNext adapter capability ledger check passed (${adapters.length} adapter row(s))\n`,
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-adapter-capability-ledger failed: ${message}\n`);
  process.exitCode = 1;
}
