#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');

const minAiStatementsCoverage = Number(process.env.NIMI_RUNTIME_MIN_AI_STATEMENTS_COVERAGE || '70');
const minScenarioCoreFunctionCoverage = Number(process.env.NIMI_RUNTIME_MIN_AI_SCENARIO_FUNCTION_COVERAGE || '80');

const scenarioCoreFunctions = [
  'internal/services/ai/scenario_job_store.go:SubmitScenarioJob',
  'internal/services/ai/scenario_job_store.go:GetScenarioJob',
  'internal/services/ai/scenario_job_store.go:CancelScenarioJob',
  'internal/services/ai/scenario_job_store.go:SubscribeScenarioJobEvents',
  'internal/services/ai/scenario_job_store.go:GetScenarioArtifacts',
];

function assertFiniteThreshold(value, envName) {
  if (!Number.isFinite(value)) {
    throw new Error(`[check-runtime-ai-scenario-coverage] invalid threshold ${envName}`);
  }
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
      `[check-runtime-ai-scenario-coverage] command failed: ${command} ${args.join(' ')}${details ? `\n${details}` : ''}`,
    );
  }
  return result;
}

function normalizeRuntimePath(inputPath) {
  const normalized = String(inputPath || '').replace(/\\/g, '/');
  const marker = 'github.com/nimiplatform/nimi/runtime/';
  if (normalized.startsWith(marker)) {
    return normalized.slice(marker.length);
  }
  const runtimeIndex = normalized.indexOf('/runtime/');
  if (runtimeIndex >= 0) {
    return normalized.slice(runtimeIndex + '/runtime/'.length);
  }
  return normalized;
}

function parseTotalCoverage(raw) {
  const totalLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('total:'));
  if (!totalLine) {
    throw new Error('[check-runtime-ai-scenario-coverage] unable to locate total coverage line');
  }
  const match = totalLine.match(/([0-9]+(?:\.[0-9]+)?)%/);
  if (!match) {
    throw new Error(`[check-runtime-ai-scenario-coverage] unable to parse total coverage percentage: ${totalLine}`);
  }
  return Number(match[1]);
}

function parseFunctionCoverage(raw) {
  const coverages = new Map();
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('total:')) {
      continue;
    }
    const match = trimmed.match(/^(.+?):\d+:\s+([^\s]+)\s+([0-9]+(?:\.[0-9]+)?)%$/);
    if (!match) {
      continue;
    }
    const normalizedPath = normalizeRuntimePath(match[1]);
    const functionName = match[2];
    const percentage = Number(match[3]);
    coverages.set(`${normalizedPath}:${functionName}`, percentage);
  }
  return coverages;
}

function formatPercentage(value) {
  return `${value.toFixed(1)}%`;
}

function main() {
  assertFiniteThreshold(minAiStatementsCoverage, 'NIMI_RUNTIME_MIN_AI_STATEMENTS_COVERAGE');
  assertFiniteThreshold(minScenarioCoreFunctionCoverage, 'NIMI_RUNTIME_MIN_AI_SCENARIO_FUNCTION_COVERAGE');

  process.stdout.write(
    `[check-runtime-ai-scenario-coverage] running ai package coverage with statements>=${minAiStatementsCoverage}% and scenario-core-function>=${minScenarioCoreFunctionCoverage}%\n`,
  );

  const coverProfilePath = path.join(
    os.tmpdir(),
    `nimi-runtime-ai-cover-${Date.now()}-${Math.random().toString(16).slice(2)}.out`,
  );

  try {
    run('go', ['test', './internal/services/ai', '-covermode=atomic', `-coverprofile=${coverProfilePath}`], {
      cwd: runtimeDir,
    });

    const coverageResult = run('go', ['tool', 'cover', `-func=${coverProfilePath}`], {
      cwd: runtimeDir,
      capture: true,
    });
    const coverageOutput = String(coverageResult.stdout || '');
    const aiStatementsCoverage = parseTotalCoverage(coverageOutput);
    process.stdout.write(
      `[check-runtime-ai-scenario-coverage] ai package statements coverage: ${formatPercentage(aiStatementsCoverage)}\n`,
    );
    if (aiStatementsCoverage < minAiStatementsCoverage) {
      throw new Error(
        `[check-runtime-ai-scenario-coverage] ai package coverage gate failed: got ${formatPercentage(aiStatementsCoverage)}, required >= ${formatPercentage(minAiStatementsCoverage)}`,
      );
    }

    const functionCoverage = parseFunctionCoverage(coverageOutput);
    const missingFunctions = [];
    const belowThreshold = [];
    for (const functionKey of scenarioCoreFunctions) {
      if (!functionCoverage.has(functionKey)) {
        missingFunctions.push(functionKey);
        continue;
      }
      const percentage = functionCoverage.get(functionKey) || 0;
      process.stdout.write(
        `[check-runtime-ai-scenario-coverage] ${functionKey}: ${formatPercentage(percentage)}\n`,
      );
      if (percentage < minScenarioCoreFunctionCoverage) {
        belowThreshold.push({ functionKey, percentage });
      }
    }

    if (missingFunctions.length > 0) {
      throw new Error(
        `[check-runtime-ai-scenario-coverage] missing scenario core functions in coverage report: ${missingFunctions.join(', ')}`,
      );
    }
    if (belowThreshold.length > 0) {
      const details = belowThreshold
        .map((item) => `${item.functionKey}=${formatPercentage(item.percentage)}`)
        .join(', ');
      throw new Error(
        `[check-runtime-ai-scenario-coverage] scenario core function coverage gate failed: ${details}, required >= ${formatPercentage(minScenarioCoreFunctionCoverage)}`,
      );
    }

    process.stdout.write('[check-runtime-ai-scenario-coverage] ai/scenario coverage gates passed\n');
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
