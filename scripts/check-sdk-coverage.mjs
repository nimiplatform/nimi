#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const coverageChecks = [
  {
    label: '@nimiplatform/sdk coverage',
    include: [
      'sdk/src/ai-provider/**/*.ts',
      'sdk/src/client.ts',
      'sdk/src/realm/index.ts',
      'sdk/src/runtime/**/*.ts',
      'sdk/src/scope/**/*.ts',
      'sdk/src/types/index.ts',
    ],
    exclude: [
      'sdk/src/realm/generated/**/*.ts',
      'sdk/src/runtime/generated/**/*.ts',
      'sdk/src/runtime/types.ts',
    ],
    tests: 'sdk/test/**/*.test.ts',
    thresholds: {
      lines: Number(process.env.NIMI_SDK_MIN_LINES_COVERAGE || '90'),
      branches: Number(process.env.NIMI_SDK_MIN_BRANCHES_COVERAGE || '70'),
      functions: Number(process.env.NIMI_SDK_MIN_FUNCTIONS_COVERAGE || '90'),
    },
  },
];

function runNodeTestCoverage(check) {
  const testFiles = globSync(check.tests, { cwd: repoRoot, absolute: false })
    .map((file) => file.replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b));
  if (testFiles.length === 0) {
    throw new Error(`[check-sdk-coverage] ${check.label}: no test files matched ${check.tests}`);
  }

  const args = [
    '--import',
    'tsx',
    '--test',
    '--experimental-test-coverage',
    ...check.include.map((pattern) => `--test-coverage-include=${pattern}`),
    ...(check.exclude || []).map((pattern) => `--test-coverage-exclude=${pattern}`),
    `--test-coverage-lines=${check.thresholds.lines}`,
    `--test-coverage-branches=${check.thresholds.branches}`,
    `--test-coverage-functions=${check.thresholds.functions}`,
    ...testFiles,
  ];

  process.stdout.write(
    `[check-sdk-coverage] ${check.label}: lines>=${check.thresholds.lines}, branches>=${check.thresholds.branches}, functions>=${check.thresholds.functions}\n`,
  );

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(
      `[check-sdk-coverage] ${check.label} failed with exit code ${String(result.status ?? 'unknown')}`,
    );
  }
}

function main() {
  for (const check of coverageChecks) {
    runNodeTestCoverage(check);
  }
  process.stdout.write('[check-sdk-coverage] all sdk coverage gates passed\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
