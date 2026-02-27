#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SDK_VNEXT_TEST_FILES = [
  'sdk/test/runtime/runtime-bridge-method-parity.test.ts',
  'sdk/test/realm/realm-client.test.ts',
  'sdk/test/scope/module.test.ts',
  'sdk/test/ai-provider/provider.test.ts',
  'sdk/test/mod/mod-runtime-context.test.ts',
  'sdk/test/integration/runtime-realm-orchestration.test.ts',
];

function assertTestFilesExist() {
  const missing = SDK_VNEXT_TEST_FILES.filter((file) => !existsSync(path.join(repoRoot, file)));
  if (missing.length > 0) {
    throw new Error(
      `[check-sdk-vnext-matrix] missing required test files:\n${missing.map((file) => `- ${file}`).join('\n')}`,
    );
  }
}

function runMatrixTests() {
  process.stdout.write(`[check-sdk-vnext-matrix] running ${SDK_VNEXT_TEST_FILES.length} fixed test suites\n`);
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '--test',
    ...SDK_VNEXT_TEST_FILES,
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

function main() {
  assertTestFilesExist();
  runMatrixTests();
  process.stdout.write('[check-sdk-vnext-matrix] all vNext matrix tests passed\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
