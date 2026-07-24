#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnSyncCommand } from './lib/command-runner.mjs';
import {
  SDK_DIST_PREPARED_ENV,
  withSdkDistLock,
} from './lib/sdk-dist-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// These checks are the non-overlapping SDK release-contract leaves. The SDK
// coverage gate separately owns the full package test suite; typed-core
// conformance, generator drift, packaged-consumer smoke, and version parity
// remain independent release boundaries.
const CHECKS = [
  'check:sdk-root-entry-contract',
  'check:sdk-vnext-package-contract',
  'check:sdk-vnext-runtime-facade',
  'check:sdk-vnext-public-surface-smoke',
  'check:sdk-vnext-runtime-consumer-smoke',
  'check:sdk-vnext-app-consumer-smoke',
  'check:sdk-vnext-realm-consumer-smoke',
  'check:sdk-vnext-world-consumer-smoke',
  'check:sdk-vnext-ai-consumer-smoke',
  'check:sdk-vnext-ai-runner-consumer-smoke',
  'check:sdk-vnext-root-consumer-smoke',
  'check:sdk-doctor',
  'check:no-global-openapi-config',
  'check:experimental-api-lifecycle',
];

function runPnpm(args, label) {
  process.stdout.write(`[check-sdk-release-contracts] ${label}\n`);
  const result = spawnSyncCommand('pnpm', args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} exited with status ${result.status ?? 1}`);
  }
}

function assertUniqueChecks() {
  const unique = new Set(CHECKS);
  if (unique.size !== CHECKS.length) {
    throw new Error('duplicate SDK release-contract command');
  }
}

async function main() {
  assertUniqueChecks();
  await withSdkDistLock('SDK release contracts', async () => {
    runPnpm(['--filter', '@nimiplatform/sdk', 'build'], 'prepare SDK distribution once');

    const previousPrepared = process.env[SDK_DIST_PREPARED_ENV];
    process.env[SDK_DIST_PREPARED_ENV] = '1';
    try {
      for (const check of CHECKS) {
        runPnpm([check], check);
      }
    } finally {
      if (previousPrepared === undefined) delete process.env[SDK_DIST_PREPARED_ENV];
      else process.env[SDK_DIST_PREPARED_ENV] = previousPrepared;
    }
  });
  process.stdout.write(
    `[check-sdk-release-contracts] passed ${CHECKS.length} non-overlapping contract checks with one prepared SDK build\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `[check-sdk-release-contracts] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
