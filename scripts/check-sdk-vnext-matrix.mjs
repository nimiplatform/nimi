#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');

function runMatrixTests() {
  process.stdout.write('[check-sdk-vnext-matrix] running full sdks/typescript test suite\n');
  const result = spawnSync('pnpm', [
    '--dir',
    vnextRoot,
    'test',
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    const code = result.status ?? 1;
    throw new Error(`[check-sdk-vnext-matrix] failed with exit code ${String(code)}`);
  }
}

function runVNextPackageContract() {
  const checks = [
    ['scripts/check-sdk-vnext-package-contract.mjs'],
    ['scripts/check-sdk-vnext-runtime-facade.mjs'],
    ['scripts/check-sdk-vnext-public-surface-smoke.mjs'],
    ['scripts/check-sdk-vnext-runtime-consumer-smoke.mjs'],
    ['scripts/check-sdk-vnext-app-consumer-smoke.mjs'],
    ['scripts/check-sdk-vnext-realm-consumer-smoke.mjs'],
    ['scripts/check-sdk-vnext-world-consumer-smoke.mjs'],
    ['scripts/check-sdk-vnext-ai-consumer-smoke.mjs'],
    ['scripts/check-sdk-vnext-agent-consumer-smoke.mjs'],
    ['scripts/check-sdk-vnext-root-consumer-smoke.mjs'],
    ['scripts/check-sdk-vnext-ai-capability-ledger.mjs'],
    ['scripts/check-sdk-vnext-adapter-capability-ledger.mjs'],
    ['scripts/check-sdk-vnext-migration-proofs.mjs'],
    ['scripts/check-sdk-vnext-root-composition-decision.mjs'],
    ['scripts/check-sdk-vnext-first-party-adaptation.mjs'],
    ['scripts/check-sdk-vnext-replacement-ledger.mjs'],
  ];

  for (const args of checks) {
    const result = spawnSync('node', args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      const code = result.status ?? 1;
      throw new Error(`[check-sdk-vnext-matrix] vNext prerequisite failed with exit code ${String(code)}: node ${args.join(' ')}`);
    }
  }
}

function main() {
  runVNextPackageContract();
  runMatrixTests();
  process.stdout.write('[check-sdk-vnext-matrix] all configured vNext prerequisite and honesty gates passed; Replacement coverage acceptance status is reported by the replacement ledger\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
