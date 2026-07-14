#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runContractSuite } from '../contract/runner.mjs';
import { readLocalAgentTestArchitecture, repoRoot } from './registry.mjs';
import { sweepStaleIsolatedTrialRoots } from './sandbox-hygiene.mjs';
import { captureSourceState } from './source-state.mjs';
import { validateArchitecture } from './validation.mjs';

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const gate = option('--gate');
if (!['contract', 'core', 'core-stability', 'extended', 'exhaustive'].includes(gate)) throw new Error(`unsupported LocalAgent product gate ${gate || '<missing>'}`);
// Route interruption through process.exit so 'exit' teardown hooks (subprocess-tree
// kill in cross-app-driver) run instead of the signal default, which skips them.
for (const abortSignal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(abortSignal, () => {
    process.stderr.write(`local-agent-product ${gate}: received ${abortSignal}; tearing down owned subprocesses\n`);
    process.exitCode = 1;
    process.exit();
  });
}
const sweep = sweepStaleIsolatedTrialRoots();
if (sweep.swept.length > 0) process.stdout.write(`local-agent-product ${gate}: removed ${sweep.swept.length} stale trial sandbox(es): ${sweep.swept.join(', ')}\n`);
if (sweep.failed.length > 0) {
  throw new Error(`local-agent-product ${gate}: stale trial cleanup refused: ${sweep.failed.map((failure) => `${failure.root} (${failure.code}): ${failure.message}`).join('; ')}`);
}
const architecture = readLocalAgentTestArchitecture();
const architectureFailures = validateArchitecture(architecture);
if (architectureFailures.length > 0) throw new Error(`invalid LocalAgent test architecture: ${architectureFailures.join('; ')}`);
const sourceState = captureSourceState(repoRoot);
const evidenceRoot = path.resolve(process.env.NIMI_LOCAL_AGENT_EVIDENCE_ROOT || path.join(
  repoRoot,
  '.nimi',
  'local',
  'evidence',
  'local-agent-full-chain',
  `v2-${gate}-${sourceState.sourceDigest.slice(0, 12)}-${Date.now()}`,
));
fs.mkdirSync(evidenceRoot, { recursive: true });
const gateStarted = performance.now();
const records = [];

if (gate === 'contract' || gate === 'exhaustive') {
  const suiteId = gate === 'exhaustive' ? 'deterministic-exhaustive' : 'contract-smoke';
  const persisted = await runContractSuite({
    outputDir: path.join(evidenceRoot, 'suite', suiteId),
    mode: gate === 'exhaustive' ? 'exhaustive' : 'contract',
  });
  records.push({
    kind: 'suite',
    id: suiteId,
    repeatIndex: 1,
    resultPath: path.relative(evidenceRoot, persisted.resultPath),
    durationMs: persisted.result.durationMs,
    outcome: persisted.result.outcome,
  });
} else {
  const { runJourneyGate } = await import('./journey-runner.mjs');
  records.push(...await runJourneyGate({ architecture, evidenceRoot, gate, sourceState }));
}

const ledger = {
  schemaVersion: 'nimi.local-agent-product-gate-ledger/v2',
  gate,
  sourceState,
  durationMs: Math.round(performance.now() - gateStarted),
  records,
};
const ledgerPath = path.join(evidenceRoot, 'gate-ledger.json');
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
const admission = spawnSync(process.execPath, [
  path.join(repoRoot, 'scripts', 'check-local-agent-product-acceptance.mjs'),
  '--gate', gate,
  '--evidence-root', evidenceRoot,
], { cwd: repoRoot, stdio: 'inherit', env: process.env });
if (admission.error) throw admission.error;
if (admission.status !== 0) process.exit(admission.status ?? 1);

const indexPath = path.join(repoRoot, '.nimi', 'local', 'evidence', 'local-agent-full-chain', 'v2-index.json');
fs.mkdirSync(path.dirname(indexPath), { recursive: true });
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : {
  schemaVersion: 'nimi.local-agent-product-evidence-index/v2',
  gates: {},
};
index.gates[gate] = { evidenceRoot, sourceDigest: sourceState.sourceDigest, completedAt: new Date().toISOString() };
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
process.stdout.write(`local-agent-product ${gate}: PASS (${ledger.durationMs}ms; ${records.length} records; ${evidenceRoot})\n`);
