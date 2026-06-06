#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sdkRoot = path.join(repoRoot, 'sdks', 'typescript');
const pnpmBin = 'pnpm';

function quoteCmdArg(value) {
  if (!/[ \t"&|<>^]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runPnpm(args) {
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', [pnpmBin, ...args].map(quoteCmdArg).join(' ')], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
  }
  return spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
}

const coverageChecks = [
  {
    label: '@nimiplatform/sdk vNext coverage',
    include: [
      'adapters/**/*.ts',
      'core/**/*.ts',
      'features/**/*.ts',
      'realm/**/*.ts',
      'runtime/**/*.ts',
      'types/**/*.ts',
      'index.ts',
      'root-client.ts',
    ],
    exclude: [
      '**/*.test.ts',
      '**/*.test-helper.ts',
      '**/*.generated.ts',
      '**/*-types.ts',
      'core-generated/**/*.ts',
      'dist/**/*.ts',
    ],
    tests: '**/*.test.ts',
    thresholds: {
      lines: Number(process.env.NIMI_SDK_MIN_LINES_COVERAGE || '90'),
      branches: Number(process.env.NIMI_SDK_MIN_BRANCHES_COVERAGE || '70'),
      functions: Number(process.env.NIMI_SDK_MIN_FUNCTIONS_COVERAGE || '90'),
    },
  },
];

function runNodeTestCoverage(check) {
  const buildResult = runPnpm(['--filter', '@nimiplatform/sdk', 'build']);
  if (buildResult.status !== 0) {
    throw new Error(
      `[check-sdk-coverage] failed to build @nimiplatform/sdk before coverage with exit code ${String(buildResult.status ?? 'unknown')}`,
    );
  }

  const testFiles = globSync(check.tests, { cwd: sdkRoot, absolute: false })
    .map((file) => file.replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b));
  if (testFiles.length === 0) {
    throw new Error(`[check-sdk-coverage] ${check.label}: no test files matched ${check.tests}`);
  }

  const args = [
    '--dir',
    sdkRoot,
    'exec',
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

  const result = runPnpm(args);

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
