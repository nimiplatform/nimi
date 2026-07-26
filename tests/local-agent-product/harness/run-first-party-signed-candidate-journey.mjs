#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  FIRST_PARTY_PRODUCT_PRIVATE_ENV_NAMES,
  resolveFirstPartyProductRoot,
} from './first-party-product-contract.mjs';
import { safeHarnessFailure } from './p4-errors.mjs';
import { parseP4Manifest } from './p4-manifest.mjs';
import { executeP4WorkerGate } from './p4-worker-supervisor.mjs';
import { readExecutionPolicy, readJourneyRegistry, repoRoot } from './registry.mjs';
import { buildMergedEnv } from '../../../scripts/lib/live-env.mjs';

// Capture shell input before .env is read. The manifest parser receives this
// immutable startup view, so .env can never become a hidden budget override.
const STARTUP_SHELL_ENV = Object.freeze({ ...process.env });

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasOption(name) {
  return process.argv.includes(name);
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

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || result.error?.message || `${command} failed`).trim());
  }
  return String(result.stdout || '').trim();
}

function resetStaleFirstRunControl(productRoot) {
  const output = run('pwsh.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(repoRoot, 'scripts', 'reset-windows-first-party-product-control.ps1'),
    '-Mode',
    'Reset',
    '-ProductRoot',
    productRoot,
    '-Json',
  ]);
  if (output) process.stdout.write(`${output}\n`);
}

function writeLedger(file, ledger) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    process.stderr.write(`diagnostic gate ledger was not written: ${String(error?.message || error)}\n`);
  }
}

function initialRecord(definition) {
  return {
    kind: 'product_gate',
    id: definition.gate,
    journeyId: definition.journeyId,
    label: definition.label,
    outcome: 'not_run',
    manifestBudgetMs: definition.manifestBudgetMs,
    effectiveBudgetMs: definition.effectiveBudgetMs,
    budgetSource: definition.budgetSource,
    durationMs: 0,
    harnessFailure: null,
    childExitCode: null,
    childSignal: null,
    deadline: { exceeded: false, failure: null },
    termination: { attempted: false, outcome: 'not_needed', failure: null },
  };
}

export async function main() {
  if (option('--gate') !== 'all') {
    throw new Error('P4 has one active target: --gate all (Gate 0 -> Gate 1 -> Gate 2)');
  }

  const productGates = parseP4Manifest(readExecutionPolicy(), readJourneyRegistry(), STARTUP_SHELL_ENV);
  loadFirstPartyProductEnv();
  if (!process.env.REALM_ROOT) process.env.REALM_ROOT = 'D:\\nimi-realm';
  const productRoot = resolveFirstPartyProductRoot(option('--product-root', process.env.NIMI_FIRST_PARTY_PRODUCT_ROOT || ''));
  if (hasOption('--reset-stale-first-run-control')) resetStaleFirstRunControl(productRoot);

  const startedAt = new Date().toISOString();
  const started = performance.now();
  const evidenceRoot = path.resolve(process.env.NIMI_LOCAL_AGENT_EVIDENCE_ROOT || path.join(
    repoRoot,
    '.nimi',
    'local',
    'evidence',
    'local-agent-full-chain',
    `v2-p4-product-${Date.now()}`,
  ));
  const ledgerPath = path.join(evidenceRoot, 'gate-ledger.json');
  const ledger = {
    schemaVersion: 'nimi.local-agent-product-gate-ledger/v3',
    gate: 'p4',
    startedAt,
    completedAt: null,
    durationMs: 0,
    productRoot: path.resolve(productRoot),
    records: productGates.map(initialRecord),
    rootId: null,
    accountIds: [],
    candidateIdentity: null,
    gate0ExecutionEvidenceRef: null,
    failure: null,
  };
  writeLedger(ledgerPath, ledger);

  let prerequisite = null;
  let currentGate = null;
  try {
    for (const [index, definition] of productGates.entries()) {
      currentGate = definition;
      const record = ledger.records[index];
      record.outcome = 'running';
      writeLedger(ledgerPath, ledger);
      process.stdout.write(`${definition.label}: running\n`);

      const { observations, telemetry } = await executeP4WorkerGate({
        definition,
        repoRoot,
        outputDir: path.join(evidenceRoot, definition.gate),
        prerequisite,
        productRoot,
      });
      Object.assign(record, telemetry);

      if (definition.gate === 'first-run') {
        ledger.rootId = observations.rootId;
        ledger.accountIds = observations.accountIds;
        ledger.candidateIdentity = observations.candidateIdentity;
        ledger.gate0ExecutionEvidenceRef = observations.candidateIdentity.executionEvidenceRef;
        prerequisite = {
          rootId: observations.rootId,
          accountIds: observations.accountIds,
          candidateIdentity: observations.candidateIdentity,
          gate0ExecutionEvidenceRef: observations.candidateIdentity.executionEvidenceRef,
        };
      }

      record.outcome = 'passed';
      writeLedger(ledgerPath, ledger);
      process.stdout.write(`${definition.label}: passed\n`);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const record = ledger.records.find((candidate) => candidate.id === currentGate?.gate);
    if (record) {
      record.outcome = 'failed';
      if (failure.telemetry) Object.assign(record, failure.telemetry);
      if (!record.harnessFailure) record.harnessFailure = safeHarnessFailure(failure);
    }
    ledger.failure = {
      gate: currentGate?.label || 'preflight',
      ...safeHarnessFailure(failure),
    };
    ledger.completedAt = new Date().toISOString();
    ledger.durationMs = Math.round(performance.now() - started);
    writeLedger(ledgerPath, ledger);
    process.stderr.write(`${currentGate?.label || 'P4'}: failed: ${failure.message}\n`);
    process.stderr.write(`Evidence: ${evidenceRoot}\n`);
    return 1;
  }

  ledger.completedAt = new Date().toISOString();
  ledger.durationMs = Math.round(performance.now() - started);
  writeLedger(ledgerPath, ledger);
  process.stdout.write(`P4 Gate 0 -> 1 -> 2: passed\nEvidence: ${evidenceRoot}\n`);
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
