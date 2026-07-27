#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIRST_PARTY_PRODUCT_PRIVATE_ENV_NAMES } from './first-party-product-contract.mjs';
import { executeP4WorkerGate } from './p4-worker-supervisor.mjs';
import { buildMergedEnv } from '../../../scripts/lib/live-env.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const BUDGET_ENV_NAME = 'NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS';
const PRODUCT_GATES = Object.freeze([
  Object.freeze({
    gate: 'first-run',
    label: 'Gate 0',
    journeyId: 'first-party-installed-first-run',
    defaultBudgetMs: 1_800_000,
  }),
  Object.freeze({
    gate: 'direct-nimi',
    label: 'Gate 1',
    journeyId: 'first-party-direct-nimi',
    defaultBudgetMs: 1_800_000,
  }),
  Object.freeze({
    gate: 'partner-core',
    label: 'Gate 2',
    journeyId: 'first-party-partner-core',
    defaultBudgetMs: 3_600_000,
  }),
]);

// Capture shell input before .env is read so .env cannot become a hidden
// journey-budget override.
const STARTUP_SHELL_ENV = Object.freeze({ ...process.env });

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function loadFirstPartyProductEnv() {
  const fileEnv = buildMergedEnv({ baseEnv: {}, filePaths: [path.join(repoRoot, '.env')] });
  for (const name of FIRST_PARTY_PRODUCT_PRIVATE_ENV_NAMES) {
    if (process.env[name] === undefined && fileEnv[name] !== undefined) process.env[name] = fileEnv[name];
  }
  if (process.env.REALM_ROOT === undefined && fileEnv.REALM_ROOT !== undefined) {
    process.env.REALM_ROOT = fileEnv.REALM_ROOT;
  }
}

function buildProductGates(startupEnv) {
  const hasOverride = Object.hasOwn(startupEnv, BUDGET_ENV_NAME);
  let override = null;
  if (hasOverride) {
    override = Number(startupEnv[BUDGET_ENV_NAME]);
    if (!Number.isSafeInteger(override) || override <= 0) {
      throw new Error(`${BUDGET_ENV_NAME} must be a positive safe integer`);
    }
  }
  return PRODUCT_GATES.map((definition) => Object.freeze({
    ...definition,
    effectiveBudgetMs: override ?? definition.defaultBudgetMs,
    budgetSource: hasOverride ? 'environment' : 'runner',
  }));
}

export async function main() {
  if (option('--gate') !== 'all') {
    throw new Error('P4 has one active target: --gate all (Gate 0 -> Gate 1 -> Gate 2)');
  }

  const productGates = buildProductGates(STARTUP_SHELL_ENV);
  loadFirstPartyProductEnv();
  if (!process.env.REALM_ROOT) process.env.REALM_ROOT = 'D:\\nimi-realm';

  const outputRoot = path.resolve(process.env.NIMI_LOCAL_AGENT_EVIDENCE_ROOT || path.join(
    repoRoot,
    '.nimi',
    'local',
    'evidence',
    'local-agent-full-chain',
    `v2-p4-product-${Date.now()}`,
  ));

  let prerequisite = null;
  let currentGate = null;
  try {
    for (const definition of productGates) {
      currentGate = definition;
      process.stdout.write(`${definition.label}: running\n`);

      const { observations } = await executeP4WorkerGate({
        definition,
        repoRoot,
        outputDir: path.join(outputRoot, definition.gate),
        prerequisite,
      });

      if (definition.gate === 'first-run') {
        prerequisite = {
          rootId: observations.rootId,
          accountIds: observations.accountIds,
          candidateIdentity: observations.candidateIdentity,
        };
      }

      process.stdout.write(`${definition.label}: passed\n`);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(`${currentGate?.label || 'P4'}: failed: ${failure.message}\n`);
    process.stderr.write(`Run output: ${outputRoot}\n`);
    return 1;
  }

  process.stdout.write(`P4 Gate 0 -> 1 -> 2: passed\nRun output: ${outputRoot}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`P4: failed: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
