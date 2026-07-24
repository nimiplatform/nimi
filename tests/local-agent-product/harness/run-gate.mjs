#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pruneOldGateEvidenceRuns } from './evidence-retention.mjs';
import { readLocalAgentTestArchitecture, repoRoot } from './registry.mjs';
import { sweepStaleIsolatedTrialRoots } from './sandbox-hygiene.mjs';
import { captureSourceState } from './source-state.mjs';

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const usage = 'Usage: node tests/local-agent-product/harness/run-gate.mjs --gate <core|core-stability> [--repeats <positive-integer>]\n';
if (process.argv.includes('--help') || process.argv.length === 2) {
  process.stdout.write(usage);
  process.exit(0);
}

const gate = option('--gate');
if (!['core', 'core-stability'].includes(gate)) throw new Error(`unsupported LocalAgent product gate ${gate || '<missing>'}`);
const repeats = Number(option('--repeats', '1'));
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('--repeats must be a positive integer');
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
  process.stderr.write(`local-agent-product ${gate}: skipped ${sweep.failed.length} stale trial sandbox(es) after cleanup warnings: ${sweep.failed.map((failure) => `${failure.root} (${failure.code}): ${failure.message}`).join('; ')}\n`);
}
const architecture = readLocalAgentTestArchitecture();
const sourceState = captureSourceState(repoRoot);
const configuredEvidenceRoot = String(process.env.NIMI_LOCAL_AGENT_EVIDENCE_ROOT || '').trim();
const evidenceBaseRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'local-agent-full-chain');
if (!configuredEvidenceRoot) {
  const retentionRuns = Number(architecture.policy.evidence_retention?.runs_per_gate || 3);
  const retention = pruneOldGateEvidenceRuns(evidenceBaseRoot, gate, {
    retainPriorRuns: Math.max(0, retentionRuns - 1),
  });
  if (retention.removed.length > 0) {
    process.stdout.write(`local-agent-product ${gate}: pruned ${retention.removed.length} old diagnostic evidence run(s)\n`);
  }
  for (const failure of retention.failed) {
    process.stderr.write(`local-agent-product ${gate}: warning: skipped evidence cleanup for ${failure.root} (${failure.code}): ${failure.message}\n`);
  }
}
const evidenceRoot = path.resolve(configuredEvidenceRoot || path.join(
  evidenceBaseRoot,
  `v2-${gate}-${sourceState.sourceDigest.slice(0, 12)}-${Date.now()}`,
));
fs.mkdirSync(evidenceRoot, { recursive: true });
const gateStarted = performance.now();
const records = [];

const { runJourneyGate } = await import('./journey-runner.mjs');
records.push(...await runJourneyGate({ architecture, evidenceRoot, gate, repeats, sourceState }));

const ledger = {
  schemaVersion: 'nimi.local-agent-product-gate-ledger/v2',
  gate,
  repeats,
  sourceState,
  durationMs: Math.round(performance.now() - gateStarted),
  records,
};
const ledgerPath = path.join(evidenceRoot, 'gate-ledger.json');
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(`local-agent-product ${gate}: PASS (${ledger.durationMs}ms; ${records.length} records; ${evidenceRoot})\n`);
