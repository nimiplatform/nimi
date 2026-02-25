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
    include: 'sdk/packages/sdk/src/**/*.ts',
    tests: 'sdk/packages/sdk/test/**/*.test.ts',
    thresholds: {
      lines: Number(process.env.NIMI_SDK_MIN_LINES_COVERAGE || '90'),
      branches: Number(process.env.NIMI_SDK_MIN_BRANCHES_COVERAGE || '70'),
      functions: Number(process.env.NIMI_SDK_MIN_FUNCTIONS_COVERAGE || '95'),
    },
  },
  {
    label: '@nimiplatform/sdk-runtime coverage',
    include: 'sdk/packages/runtime/src/**/*.ts',
    tests: 'sdk/packages/runtime/test/*.test.ts',
    thresholds: {
      lines: Number(process.env.NIMI_SDK_RUNTIME_MIN_LINES_COVERAGE || '68'),
      branches: Number(process.env.NIMI_SDK_RUNTIME_MIN_BRANCHES_COVERAGE || '70'),
      functions: Number(process.env.NIMI_SDK_RUNTIME_MIN_FUNCTIONS_COVERAGE || '48'),
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
    `--test-coverage-include=${check.include}`,
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
