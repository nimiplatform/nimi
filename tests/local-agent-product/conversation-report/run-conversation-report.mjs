#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { buildProductPrerequisites } from '../harness/journey-runner.mjs';
import { readLocalAgentTestArchitecture, repoRoot } from '../harness/registry.mjs';
import { assertSourceState, captureSourceState } from '../harness/source-state.mjs';
import { createIsolatedJourneyRoot, removeIsolatedTrialRoot } from '../harness/trial-root.mjs';
import { validateArchitecture } from '../harness/validation.mjs';
import {
  validateConversationReportArchitecture,
  validateConversationReportBundle,
} from './checker.mjs';
import {
  readConversationScenarioRegistry,
  resolveConversationScenarioRegistry,
  validateConversationScenarioRegistry,
} from './registry.mjs';
import { runConversationReportProductTrial } from './product-driver.mjs';

function timestampId() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const architecture = readLocalAgentTestArchitecture();
const registry = await resolveConversationScenarioRegistry(readConversationScenarioRegistry());
const architectureFailures = [
  ...validateArchitecture(architecture),
  ...validateConversationReportArchitecture(),
  ...validateConversationScenarioRegistry(registry, { resolved: true }),
];
if (architectureFailures.length > 0) {
  throw new Error(`invalid LocalAgent conversation report architecture: ${architectureFailures.join('; ')}`);
}
const scenario = registry.scenarios.find((candidate) => candidate.scenario_id === 'conversation-report-baseline');
const journey = architecture.journeys.journeys.find((candidate) => candidate.journey_id === scenario.scenario_id);
if (!journey) throw new Error('conversation-report-baseline Journey is missing');

const sourceState = captureSourceState(repoRoot);
const runId = `conversation-report-${timestampId()}-${sourceState.sourceDigest.slice(0, 12)}`;
const reportsRoot = path.join(repoRoot, '.nimi', 'local', 'reports', 'local-agent-conversation');
const bundleRoot = path.join(reportsRoot, runId);
const trial = createIsolatedJourneyRoot({
  journeyId: journey.journey_id,
  tier: journey.applicable_layer,
  batch: 'human-review-report',
  repeatIndex: 1,
});
let completed = false;
try {
  await buildProductPrerequisites([journey], trial.paths.artifacts);
  assertSourceState(sourceState, repoRoot);
  const result = await runConversationReportProductTrial({
    runId,
    scenario,
    scenarioDigest: sourceState.conversationScenarioRegistrySha256,
    journey,
    trial,
    sourceState,
    bundleRoot,
  });
  const checked = validateConversationReportBundle({ bundleRoot });
  if (checked.failures.length > 0) {
    throw new Error(`generated conversation report is mechanically incomplete: ${checked.failures.join('; ')}`);
  }
  writeJson(path.join(reportsRoot, 'latest.json'), {
    schemaVersion: 'nimi.local-agent-conversation-report-index/v1',
    runId,
    bundleRoot,
    reportHtml: path.join(bundleRoot, 'report.html'),
    reportJson: path.join(bundleRoot, 'report.json'),
    completedAt: result.report.execution.completedAt,
    reviewStatus: 'unreviewed',
  });
  completed = true;
  process.stdout.write(`LocalAgent conversation report COMPLETE (${result.report.execution.durationMs}ms; reviewStatus=unreviewed)\n`);
  process.stdout.write(`report.html: ${path.join(bundleRoot, 'report.html')}\n`);
  process.stdout.write(`report.json: ${path.join(bundleRoot, 'report.json')}\n`);
} finally {
  if (completed) removeIsolatedTrialRoot(trial);
  else process.stderr.write(`Conversation report diagnostic trial retained: ${trial.paths.root}\n`);
}
