#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readLocalAgentTestArchitecture, repoRoot } from '../tests/local-agent-product/harness/registry.mjs';
import { assertAdmittedSourceState } from '../tests/local-agent-product/harness/source-state.mjs';
import {
  validateArchitecture,
  validateJourneyRepeatIsolation,
  validateJourneyResult,
  validateSuiteResult,
} from '../tests/local-agent-product/harness/validation.mjs';

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateManifest(resultPath) {
  const failures = [];
  const resultDir = path.dirname(resultPath);
  const manifestPath = path.join(resultDir, 'artifact-manifest.json');
  if (!fs.existsSync(manifestPath)) return [`missing artifact manifest for ${resultPath}`];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 'nimi.local-agent-product-artifact-manifest/v2') failures.push(`invalid artifact manifest schema ${manifestPath}`);
  if (manifest.privacy?.ok !== true || (manifest.privacy?.findings || []).length !== 0) failures.push(`artifact manifest privacy failure ${manifestPath}`);
  const paths = new Set();
  for (const file of manifest.files || []) {
    if (paths.has(file.path)) failures.push(`duplicate artifact manifest path ${file.path}`);
    paths.add(file.path);
    const absolute = path.join(resultDir, file.path);
    if (!fs.existsSync(absolute)) failures.push(`artifact manifest missing file ${absolute}`);
    else if (sha256(absolute) !== file.sha256 || fs.statSync(absolute).size !== file.bytes) failures.push(`artifact manifest hash/size drift ${absolute}`);
    if (file.privacyClass !== 'safe_evidence') failures.push(`artifact manifest contains unsafe evidence ${file.path}`);
  }
  if (!paths.has('result.json')) failures.push(`artifact manifest does not bind result.json ${manifestPath}`);
  return failures;
}

function validateEvidenceRoot({ architecture, evidenceRoot, gate }) {
  const failures = [];
  const ledgerPath = path.join(evidenceRoot, 'gate-ledger.json');
  if (!fs.existsSync(ledgerPath)) return [`missing gate ledger ${ledgerPath}`];
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.schemaVersion !== 'nimi.local-agent-product-gate-ledger/v2' || ledger.gate !== gate || !Array.isArray(ledger.records)) failures.push(`invalid gate ledger ${ledgerPath}`);
  try { assertAdmittedSourceState(ledger.sourceState, repoRoot); } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  const currentSourceState = ledger.sourceState;
  const seenRecordIds = new Set();
  const journeyRoots = new Set();
  const journeyResults = [];
  const leafPassCounts = new Map();
  for (const record of ledger.records || []) {
    const recordId = `${record.kind}:${record.id}:${record.repeatIndex ?? 0}`;
    if (seenRecordIds.has(recordId)) failures.push(`duplicate gate record ${recordId}`);
    seenRecordIds.add(recordId);
    const resultPath = path.resolve(evidenceRoot, record.resultPath || '');
    if (!fs.existsSync(resultPath)) {
      failures.push(`missing result ${recordId}`);
      continue;
    }
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (record.kind === 'suite') {
      failures.push(...validateSuiteResult({ architecture, result, expectedSourceState: currentSourceState }).map((failure) => `${recordId}: ${failure}`));
    } else if (record.kind === 'journey') {
      const journey = architecture.journeys.journeys.find((row) => row.journey_id === record.id);
      if (!journey) failures.push(`${recordId}: unknown journey`);
      else failures.push(...validateJourneyResult({ architecture, journey, result, expectedSourceState: currentSourceState }).map((failure) => `${recordId}: ${failure}`));
      const rootId = result.environmentIdentity?.rootId;
      if (!rootId || journeyRoots.has(rootId)) failures.push(`${recordId}: Journey repeat reused or omitted its clean root`);
      journeyRoots.add(rootId);
      journeyResults.push(result);
    } else failures.push(`${recordId}: invalid record kind`);
    if (result.outcome !== 'passed') failures.push(`${recordId}: non-passing result ${result.outcome}`);
    if ((result.processProblems || []).length !== 0) failures.push(`${recordId}: process problems are non-zero`);
    if (result.privacy?.ok !== true || (result.privacy?.findings || []).length !== 0) failures.push(`${recordId}: privacy findings are non-zero`);
    for (const leaf of result.leafResults || []) {
      if (leaf.leafId.startsWith('P-')) failures.push(`${recordId}: I8 P leaf executed during I7 (${leaf.leafId})`);
      if (leaf.outcome !== 'passed') failures.push(`${recordId}: ${leaf.leafId} is ${leaf.outcome}`);
      if (leaf.outcome === 'passed') leafPassCounts.set(leaf.leafId, (leafPassCounts.get(leaf.leafId) || 0) + 1);
    }
    failures.push(...validateManifest(resultPath));
  }
  failures.push(...validateJourneyRepeatIsolation(journeyResults));

  const expected = (() => {
    const acceptancePoints = architecture.points.points.filter((point) => point.point_kind === 'acceptance_point');
    if (gate === 'contract') return { suite: 1, journeys: new Map(), leaves: acceptancePoints.filter((point) => ['L0', 'L1'].includes(point.minimum_sufficient_layer)), repeats: 1 };
    if (gate === 'first-run') return { suite: 0, journeys: new Map([['first-party-installed-first-run', 1]]), leaves: [], repeats: 1 };
    if (gate === 'direct-nimi') return { suite: 0, journeys: new Map([['first-party-direct-nimi', 1]]), leaves: [], repeats: 1 };
    if (gate === 'partner-core') return {
      suite: 0,
      journeys: new Map([['first-party-partner-core', 1]]),
      leaves: acceptancePoints.filter((point) => point.execution_binding?.journey_id === 'first-party-partner-core'),
      repeats: 1,
    };
    if (gate === 'core') return { suite: 0, journeys: new Map([['dev-kernel-core', 1]]), leaves: [], repeats: 1 };
    if (gate === 'core-stability') return { suite: 0, journeys: new Map([['dev-kernel-core', 3]]), leaves: [], repeats: 3 };
    if (gate === 'extended') {
      const journeys = new Map(
        (architecture.policy.gates.extended.journeys || [])
          .map((journey) => [journey.journey_id, journey.repeats]),
      );
      return {
        suite: 0,
        journeys,
        leaves: acceptancePoints.filter((point) => (
          point.minimum_sufficient_layer === 'L3'
          && journeys.has(point.execution_binding?.journey_id)
        )),
        repeats: 1,
      };
    }
    if (gate === 'exhaustive') return { suite: 1, journeys: new Map(), leaves: acceptancePoints.filter((point) => ['L0', 'L1'].includes(point.minimum_sufficient_layer)), repeats: 1 };
    return null;
  })();
  if (!expected) failures.push(`unsupported evidence gate ${gate}`);
  else {
    const suiteCount = (ledger.records || []).filter((record) => record.kind === 'suite').length;
    if (suiteCount !== expected.suite) failures.push(`${gate} expected ${expected.suite} suite results, got ${suiteCount}`);
    for (const [journeyId, repeats] of expected.journeys) {
      const actual = (ledger.records || []).filter((record) => record.kind === 'journey' && record.id === journeyId).length;
      if (actual !== repeats) failures.push(`${gate} expected ${journeyId} x${repeats}, got ${actual}`);
    }
    const expectedRecordCount = expected.suite + [...expected.journeys.values()].reduce((sum, value) => sum + value, 0);
    if ((ledger.records || []).length !== expectedRecordCount) failures.push(`${gate} expected ${expectedRecordCount} records, got ${(ledger.records || []).length}`);
    for (const point of expected.leaves) {
      const expectedRepeats = gate === 'core-stability' ? 3 : 1;
      if ((leafPassCounts.get(point.point_id) || 0) !== expectedRepeats) failures.push(`${gate} leaf ${point.point_id} expected ${expectedRepeats} passing outcomes, got ${leafPassCounts.get(point.point_id) || 0}`);
    }
  }
  const budget = {
    contract: architecture.policy.layer_budgets_ms.L1,
    'first-run': architecture.journeys.journeys.find((row) => row.journey_id === 'first-party-installed-first-run')?.time_budget_ms,
    'direct-nimi': architecture.journeys.journeys.find((row) => row.journey_id === 'first-party-direct-nimi')?.time_budget_ms,
    'partner-core': architecture.journeys.journeys.find((row) => row.journey_id === 'first-party-partner-core')?.time_budget_ms,
    core: architecture.policy.layer_budgets_ms.L2_hard,
    'core-stability': architecture.policy.gate_budgets_ms.core_stability_hard,
    extended: architecture.policy.gate_budgets_ms.extended_hard,
    exhaustive: architecture.policy.gate_budgets_ms.exhaustive_hard,
  }[gate];
  if (!Number.isInteger(ledger.durationMs) || ledger.durationMs < 0 || ledger.durationMs > budget) failures.push(`${gate} gate duration ${ledger.durationMs} exceeds budget ${budget}`);
  return failures;
}

function validateFirstPartyPrerequisite(evidenceRoot, gate) {
  if (!['direct-nimi', 'partner-core'].includes(gate)) return [];
  const failures = [];
  const indexPath = path.join(repoRoot, '.nimi', 'local', 'evidence', 'local-agent-full-chain', 'v2-index.json');
  if (!fs.existsSync(indexPath)) return [`${gate} requires the current first-party evidence index`];
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const current = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'gate-ledger.json'), 'utf8'));
  const required = gate === 'direct-nimi' ? ['first-run'] : ['first-run', 'direct-nimi'];
  for (const priorGate of required) {
    const priorRoot = index.gates?.[priorGate]?.evidenceRoot;
    if (!priorRoot) {
      failures.push(`${gate} prerequisite ${priorGate} is missing`);
      continue;
    }
    const prior = JSON.parse(fs.readFileSync(path.join(priorRoot, 'gate-ledger.json'), 'utf8'));
    if (prior.sourceState?.sourceDigest !== current.sourceState?.sourceDigest
      || JSON.stringify(prior.candidateIdentity) !== JSON.stringify(current.candidateIdentity)
      || prior.gate0ExecutionEvidenceRef !== current.gate0ExecutionEvidenceRef) {
      failures.push(`${gate} does not reuse the exact ${priorGate} candidate and Gate 0 executionEvidenceRef`);
    }
  }
  return failures;
}

const architecture = readLocalAgentTestArchitecture();
const failures = validateArchitecture(architecture);
const requestedGate = option('--gate');
const requestedRoot = option('--evidence-root');
if (requestedGate || requestedRoot) {
  if (!requestedGate || !requestedRoot) failures.push('--gate and --evidence-root must be provided together');
  else {
    const evidenceRoot = path.resolve(requestedRoot);
    failures.push(...validateEvidenceRoot({ architecture, evidenceRoot, gate: requestedGate }));
    failures.push(...validateFirstPartyPrerequisite(evidenceRoot, requestedGate));
  }
} else {
  const indexPath = path.join(repoRoot, '.nimi', 'local', 'evidence', 'local-agent-full-chain', 'v2-index.json');
  if (!fs.existsSync(indexPath)) failures.push(`missing I7 evidence index ${indexPath}`);
  else {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const requiredGates = ['contract', 'core-stability', 'extended'];
    let sourceDigest = '';
    for (const gate of requiredGates) {
      const evidenceRoot = index.gates?.[gate]?.evidenceRoot;
      if (!evidenceRoot) {
        failures.push(`evidence index missing ${gate}`);
        continue;
      }
      const ledgerPath = path.join(evidenceRoot, 'gate-ledger.json');
      if (fs.existsSync(ledgerPath)) {
        const digest = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).sourceState?.sourceDigest || '';
        if (!sourceDigest) sourceDigest = digest;
        else if (digest !== sourceDigest) failures.push(`gate source digest mismatch ${gate}`);
      }
      failures.push(...validateEvidenceRoot({ architecture, evidenceRoot, gate }));
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`local-agent-product-acceptance: ${failure}\n`);
  process.exit(1);
}
process.stdout.write(requestedGate
  ? `local-agent-product-acceptance: OK (${requestedGate})\n`
  : 'local-agent-product-acceptance: OK (I7 acceptance facts only; I8 human-review report is on demand)\n');
