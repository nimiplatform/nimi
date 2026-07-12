import assert from 'node:assert/strict';
import test from 'node:test';
import { extendedCommandPlans, validateExtendedCommandPlan } from './extended-plan.mjs';
import { readLocalAgentTestArchitecture } from './registry.mjs';

test('extended command plans cover checkpoints without scheduling one process per leaf', () => {
  const architecture = readLocalAgentTestArchitecture();
  for (const [journeyId, plan] of Object.entries(extendedCommandPlans)) {
    const journey = architecture.journeys.journeys.find((row) => row.journey_id === journeyId);
    assert.ok(journey, `missing Journey registry row ${journeyId}`);
    assert.deepEqual(validateExtendedCommandPlan(journey, plan), []);
    const leafCount = journey.checkpoints.reduce((count, checkpoint) => count + checkpoint.covered_leaf_ids.length, 0);
    assert.ok(plan.steps.length < leafCount || leafCount === 1, `${journeyId} regressed to leaf-per-process scheduling`);
  }
});
