#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const minStatementsCoverage = Number(process.env.NIMI_RUNTIME_MIN_STATEMENTS_COVERAGE || '60');
const coveragePackages = (process.env.NIMI_RUNTIME_COVERAGE_PACKAGES || './internal/services/...')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

if (!Number.isFinite(minStatementsCoverage)) {
  process.stderr.write('[check-runtime-go-coverage] invalid threshold NIMI_RUNTIME_MIN_STATEMENTS_COVERAGE\n');
  process.exit(1);
}
if (coveragePackages.length === 0) {
  process.stderr.write('[check-runtime-go-coverage] invalid coverage package scope NIMI_RUNTIME_COVERAGE_PACKAGES\n');
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const details = [stdout, stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `[check-runtime-go-coverage] command failed: ${command} ${args.join(' ')}${details ? `\n${details}` : ''}`,
    );
  }

  return result;
}

function parseTotalCoverage(raw) {
  const totalLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('total:'));
  if (!totalLine) {
    throw new Error('[check-runtime-go-coverage] unable to locate total coverage line from go tool output');
  }

  const match = totalLine.match(/([0-9]+(?:\.[0-9]+)?)%/);
  if (!match) {
    throw new Error(`[check-runtime-go-coverage] unable to parse coverage percentage: ${totalLine}`);
  }

  return Number(match[1]);
}

function main() {
  const coverProfilePath = path.join(
    os.tmpdir(),
    `nimi-runtime-cover-${Date.now()}-${Math.random().toString(16).slice(2)}.out`,
  );

  try {
    process.stdout.write(
      `[check-runtime-go-coverage] running go test for ${coveragePackages.join(' ')} with statements threshold >= ${minStatementsCoverage}%\n`,
    );
    run('go', ['test', ...coveragePackages, '-covermode=atomic', `-coverprofile=${coverProfilePath}`], {
      cwd: runtimeDir,
    });

    const coverageResult = run('go', ['tool', 'cover', `-func=${coverProfilePath}`], {
      cwd: runtimeDir,
      capture: true,
    });

    const totalStatementsCoverage = parseTotalCoverage(String(coverageResult.stdout || ''));
    process.stdout.write(
      `[check-runtime-go-coverage] total statements coverage: ${totalStatementsCoverage.toFixed(1)}%\n`,
    );

    if (totalStatementsCoverage < minStatementsCoverage) {
      throw new Error(
        `[check-runtime-go-coverage] coverage gate failed: got ${totalStatementsCoverage.toFixed(1)}%, required >= ${minStatementsCoverage.toFixed(1)}%`,
      );
    }

    process.stdout.write('[check-runtime-go-coverage] runtime go coverage gate passed\n');
  } finally {
    if (existsSync(coverProfilePath)) {
      rmSync(coverProfilePath, { force: true });
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
