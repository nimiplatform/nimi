#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { buildProductPrerequisites } from './journey-runner.mjs';
import { runDevKernelOwnerMinimalTrial } from './dev-kernel-cross-app-driver.mjs';
import { validateOwnerMinimalResult } from './dev-kernel-owner-minimal-contract.mjs';
import { readLocalAgentTestArchitecture, repoRoot } from './registry.mjs';
import { pruneRetainedTrialRootPayload } from './sandbox-hygiene.mjs';
import { captureSourceState } from './source-state.mjs';
import { createIsolatedJourneyRoot, removeIsolatedTrialRoot } from './trial-root.mjs';

const architecture = readLocalAgentTestArchitecture();
const journey = architecture.journeys.journeys.find((entry) => entry.journey_id === 'dev-kernel-core');
if (!journey) throw new Error('dev-kernel-core journey architecture is missing');
const sourceState = captureSourceState(repoRoot);
const evidenceRoot = path.join(
  repoRoot,
  '.nimi',
  'local',
  'evidence',
  'dev-kernel-owner-minimal',
  `${sourceState.sourceDigest.slice(0, 12)}-${Date.now()}`,
);
const trial = createIsolatedJourneyRoot({
  journeyId: 'dev-kernel-owner-minimal',
  tier: 'L2',
  batch: 'owner-minimal',
  repeatIndex: 1,
});
let completed = false;

try {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  await buildProductPrerequisites([journey], evidenceRoot);
  const persisted = await runDevKernelOwnerMinimalTrial({
    architecture,
    journey,
    trial,
    sourceState,
    outputDir: path.join(evidenceRoot, 'journey'),
  });
  const issues = validateOwnerMinimalResult(persisted.result);
  if (issues.length > 0) throw new Error(`owner-minimal evidence failed: ${issues.join('; ')}`);
  completed = true;
  process.stdout.write(`dev-kernel owner-minimal: PASS (${persisted.resultPath})\n`);
} finally {
  if (completed) removeIsolatedTrialRoot(trial);
  else {
    const pruned = pruneRetainedTrialRootPayload(trial);
    process.stderr.write(`owner-minimal diagnostic root retained (payload pruned: ${pruned.pruned.join(', ') || 'none'}): ${trial.paths.root}\n`);
  }
}
