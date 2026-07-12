#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  contractPlanByLeaf,
  exhaustiveRepeatByLeaf,
} from '../tests/local-agent-product/contract/plan.mjs';
import { readLocalAgentTestArchitecture, repoRoot } from '../tests/local-agent-product/harness/registry.mjs';
import { validateArchitecture } from '../tests/local-agent-product/harness/validation.mjs';

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
  'tests/local-agent-product/harness/run-gate.mjs',
  'tests/local-agent-product/schemas/journey-result.schema.json',
  'tests/local-agent-product/schemas/suite-result.schema.json',
  'config/local-agent-product-acceptance-points.yaml',
  'config/local-agent-product-journeys.yaml',
  'config/local-agent-product-execution-policy.yaml',
  'config/local-agent-product-conversation-scenarios.yaml',
  'tests/local-agent-product/conversation-report/run-conversation-report.mjs',
  'tests/local-agent-product/conversation-report/checker.mjs',
  'tests/local-agent-product/conversation-report/report-generator.mjs',
  'tests/local-agent-product/schemas/conversation-report.schema.json',
  'scripts/check-local-agent-conversation-report.mjs',
]) {
  if (!fs.existsSync(path.join(repoRoot, relative))) failures.push(`required Journey architecture path is missing: ${relative}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const expectedScripts = {
  'check:local-agent-product-coverage': 'node scripts/check-local-agent-product-coverage.mjs',
  'test:local-agent-product-contract': 'node tests/local-agent-product/harness/run-gate.mjs --gate contract',
  'test:e2e:local-agent-product:core': 'node tests/local-agent-product/harness/run-gate.mjs --gate core',
  'test:e2e:local-agent-product:core-stability': 'node tests/local-agent-product/harness/run-gate.mjs --gate core-stability',
  'test:e2e:local-agent-product:extended': 'node tests/local-agent-product/harness/run-gate.mjs --gate extended',
  'test:local-agent-product:exhaustive': 'node tests/local-agent-product/harness/run-gate.mjs --gate exhaustive',
  'check:local-agent-product-acceptance': 'node scripts/check-local-agent-product-acceptance.mjs',
  'check:local-agent-conversation-report': 'node scripts/check-local-agent-conversation-report.mjs',
  'test:local-agent-conversation-report-contract': 'node --test tests/local-agent-product/conversation-report/*.test.mjs',
  'test:e2e:local-agent-conversation-report': 'node tests/local-agent-product/conversation-report/run-conversation-report.mjs',
  'test:e2e:local-agent-product': 'pnpm test:e2e:local-agent-product:core',
};
for (const [name, command] of Object.entries(expectedScripts)) {
  if (packageJson.scripts?.[name] !== command) failures.push(`package script ${name} must be ${command}`);
}
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (/local-agent-product/u.test(`${name} ${command}`) && /run-tier\.mjs|orchestrator\.mjs|--leaf\b/u.test(command)) {
    failures.push(`package script ${name} restores a leaf-per-process required path`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`local-agent-product-coverage: ${failure}\n`);
  process.exit(1);
}
const counts = architecture.points.minimum_layer_counts;
const journeyCounts = Object.fromEntries(architecture.journeys.journeys.map((journey) => [
  journey.journey_id,
  new Set(journey.checkpoints.flatMap((checkpoint) => checkpoint.covered_leaf_ids || checkpoint.covered_point_ids || [])).size,
]));
process.stdout.write(`local-agent-product-coverage: OK (145 acceptance points + 24 behavior observation points; layers=${JSON.stringify(counts)}; journeys=${JSON.stringify(journeyCounts)})\n`);
