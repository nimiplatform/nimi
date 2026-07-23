#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  contractPlanByLeaf,
  exhaustiveRepeatByLeaf,
} from '../tests/local-agent-product/contract/plan.mjs';
import { readLocalAgentTestArchitecture, repoRoot } from '../tests/local-agent-product/harness/registry.mjs';
import {
  summarizeArchitectureEvidence,
  validateArchitecture,
} from '../tests/local-agent-product/harness/validation.mjs';

const architecture = readLocalAgentTestArchitecture();
const failures = validateArchitecture(architecture);
const lowerLayerPoints = architecture.points.points.filter((point) => ['L0', 'L1'].includes(point.minimum_sufficient_layer));
const lowerLayerIds = new Set(lowerLayerPoints.map((point) => point.point_id));
const missingContractPlans = lowerLayerPoints.filter((point) => !contractPlanByLeaf.has(point.point_id)).map((point) => point.point_id);
const orphanContractPlans = [...contractPlanByLeaf.keys()].filter((leafId) => !lowerLayerIds.has(leafId));
const exhaustiveLogicalTrials = lowerLayerPoints.reduce((count, point) => count + (exhaustiveRepeatByLeaf.get(point.point_id) || 1), 0);
if (missingContractPlans.length > 0 || orphanContractPlans.length > 0) {
  failures.push(`contract plan coverage mismatch missing=${missingContractPlans.join(',')} orphan=${orphanContractPlans.join(',')}`);
}
if (lowerLayerPoints.length !== 71 || exhaustiveRepeatByLeaf.size !== 32 || exhaustiveLogicalTrials !== 3239) {
  failures.push(`deterministic split must preserve contract=71 and exhaustive=32x100+39x1=3239, got contract=${lowerLayerPoints.length} repeated=${exhaustiveRepeatByLeaf.size} logical=${exhaustiveLogicalTrials}`);
}
const forbiddenFiles = [
  'config/local-agent-product-e2e-scenarios.yaml',
  'tests/local-agent-product/harness/run-tier.mjs',
  'tests/local-agent-product/harness/orchestrator.mjs',
  'tests/local-agent-product/harness/registrations.mjs',
  'tests/local-agent-product/harness/product-semantic-runner.mjs',
  'config/local-agent-product-behavior.yaml',
  'tests/local-agent-product/behavior/run-live-behavior.mjs',
  'scripts/check-local-agent-live-behavior.mjs',
  'tests/local-agent-product/schemas/live-behavior-batch.schema.json',
  'tests/local-agent-product/schemas/live-behavior-evaluator.schema.json',
];
for (const relative of forbiddenFiles) {
  if (fs.existsSync(path.join(repoRoot, relative))) failures.push(`old leaf-per-process or mixed-truth path still exists: ${relative}`);
}
for (const relative of [
  'tests/local-agent-product/conversation-report/run-conversation-report.mjs',
  'tests/local-agent-product/conversation-report/product-driver.mjs',
]) {
  if (fs.existsSync(path.join(repoRoot, relative))) failures.push(`retired direct-daemon LocalAgent runner still exists: ${relative}`);
}
for (const relative of [
  'tests/local-agent-product/harness/run-gate.mjs',
  'tests/local-agent-product/harness/run-first-party-signed-candidate-journey.mjs',
  'tests/local-agent-product/harness/first-party-product-journey-driver.mjs',
  'tests/local-agent-product/schemas/journey-result.schema.json',
  'tests/local-agent-product/schemas/suite-result.schema.json',
  'config/local-agent-product-acceptance-points.yaml',
  'config/local-agent-product-journeys.yaml',
  'config/local-agent-product-execution-policy.yaml',
  'config/local-agent-product-conversation-scenarios.yaml',
  'tests/local-agent-product/conversation-report/checker.mjs',
  'tests/local-agent-product/conversation-report/report-generator.mjs',
  'tests/local-agent-product/schemas/conversation-report.schema.json',
  'scripts/check-local-agent-conversation-report.mjs',
]) {
  if (!fs.existsSync(path.join(repoRoot, relative))) failures.push(`required Journey architecture path is missing: ${relative}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const expectedScripts = {
  'check:local-agent-product-architecture': 'node scripts/check-local-agent-product-architecture.mjs',
  'test:local-agent-product-contract': 'node tests/local-agent-product/harness/run-gate.mjs --gate contract',
  'test:e2e:local-agent-product:core': 'node tests/local-agent-product/harness/run-fresh-prepared-electron-journey.mjs tests/local-agent-product/harness/run-gate.mjs --gate core',
  'test:e2e:local-agent-product:core-stability': 'node tests/local-agent-product/harness/run-gate.mjs --gate core-stability',
  'test:e2e:local-agent-product:extended': 'node tests/local-agent-product/harness/run-gate.mjs --gate extended',
  'test:local-agent-product:exhaustive': 'node tests/local-agent-product/harness/run-gate.mjs --gate exhaustive',
  'check:local-agent-product-acceptance': 'node scripts/check-local-agent-product-acceptance.mjs',
  'check:local-agent-conversation-report': 'node scripts/check-local-agent-conversation-report.mjs',
  'test:local-agent-conversation-report-contract': 'node --test tests/local-agent-product/conversation-report/*.test.mjs',
  'test:e2e:local-agent-product': 'pnpm test:e2e:local-agent-product:core',
  'test:e2e:first-party-product:p4': 'node tests/local-agent-product/harness/run-first-party-signed-candidate-journey.mjs --gate all --reset-stale-first-run-control',
  'test:e2e:first-party-product:gate-0-1-2': 'pnpm test:e2e:first-party-product:p4',
};
for (const [name, command] of Object.entries(expectedScripts)) {
  if (packageJson.scripts?.[name] !== command) failures.push(`package script ${name} must be ${command}`);
}
if (Object.hasOwn(packageJson.scripts || {}, 'test:e2e:local-agent-conversation-report')) {
  failures.push('package script test:e2e:local-agent-conversation-report restores a retired direct-daemon positive path');
}
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (/local-agent-product/u.test(`${name} ${command}`) && /run-tier\.mjs|orchestrator\.mjs|--leaf\b/u.test(command)) {
    failures.push(`package script ${name} restores a leaf-per-process required path`);
  }
}

const firstPartySources = [
  'tests/local-agent-product/harness/run-first-party-signed-candidate-journey.mjs',
  'tests/local-agent-product/harness/first-party-product-journey-driver.mjs',
].map((relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')).join('\n');
for (const forbidden of [
  'dev-kernel-cross-app-driver.mjs',
  'dev-kernel-result-driver.mjs',
  'run-fresh-prepared-electron-journey.mjs',
  'tauri-driver',
  'tauri:options',
  '__NIMI_TAURI_RUNTIME__',
  '__TAURI_INTERNALS__',
  'msedgedriver',
  'build:dev-kernel-service-candidate',
]) {
  if (firstPartySources.includes(forbidden)) failures.push(`first-party product gate must not consume ${forbidden}`);
}
for (const required of [
  "desktopRequire.resolve('playwright')",
  'electron.launch',
  'build:first-party-product-acceptance-service-candidate',
  'checkpointProfileRuntimeValidated, false',
  '__NIMI_ELECTRON_RUNTIME__',
]) {
  if (!firstPartySources.includes(required)) failures.push(`first-party product gate must retain Electron-first installed candidate behavior: ${required}`);
}
for (const relative of ['.github/workflows/release.yml', '.github/workflows/desktop-release-dry-run.yml']) {
  const workflow = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  if (!workflow.includes('pnpm test:e2e:first-party-product:p4')
    || /test:e2e:first-party-product:(?:first-run|direct-nimi|partner-core)/u.test(workflow)) {
    failures.push(`${relative} must execute the single linear P4 product target`);
  }
  if (/path:\s*\.nimi\/local\/evidence\/local-agent-full-chain\/\*\*/u.test(workflow)) {
    failures.push(`${relative} must not upload the historical local-agent-full-chain evidence owner wholesale`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`local-agent-product-architecture: ${failure}\n`);
  process.exit(1);
}
const counts = architecture.points.minimum_layer_counts;
const evidence = summarizeArchitectureEvidence(architecture);
process.stdout.write(
  `local-agent-product-architecture: VALID (catalog=${evidence.cataloguedPointCount}; currentExecutableBindings=${evidence.currentExecutablePointBindingCount}; historicalOnlyBindings=${evidence.historicalMappingOnlyPointBindingCount}; fixedServiceCheckpoints=${evidence.activeFixedServiceCheckpointCount}; fixedServiceCatalogBindings=${evidence.activeFixedServiceCataloguedPointBindingCount}; currentPointCoverage=${evidence.currentPointCoverageStatus}; layers=${JSON.stringify(counts)})\n`,
);
