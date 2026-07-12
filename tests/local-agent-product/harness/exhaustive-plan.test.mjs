import assert from 'node:assert/strict';
import test from 'node:test';
import { contractPlanByLeaf, exhaustiveRepeatByLeaf } from '../contract/plan.mjs';
import { readLocalAgentTestArchitecture } from './registry.mjs';

test('exhaustive policy preserves 3239 low-level logical trials without Electron scheduling', () => {
  const architecture = readLocalAgentTestArchitecture();
  const points = architecture.catalog.acceptance_points.filter((point) => ['L0', 'L1'].includes(point.minimum_sufficient_layer));
  assert.equal(points.length, 71);
  assert.equal(exhaustiveRepeatByLeaf.size, 32);
  assert.equal(points.reduce((count, point) => count + (exhaustiveRepeatByLeaf.get(point.leaf_id) || 1), 0), 3239);

  const grouped = new Map();
  for (const point of points) {
    const repeatCount = exhaustiveRepeatByLeaf.get(point.leaf_id) || 1;
    const steps = contractPlanByLeaf.get(point.leaf_id);
    assert.ok(Array.isArray(steps) && steps.length > 0, `${point.leaf_id} must have a low-level contract plan`);
    for (const step of steps) {
      const command = JSON.stringify([step.command, step.args, step.cwd]);
      assert.doesNotMatch(command, /electron|dist-electron|playwright/iu, `${point.leaf_id} exhaustive plan must not start Electron`);
      grouped.set(command, Math.max(grouped.get(command) || 0, repeatCount));
    }
  }
  const groupedProcessCount = [...grouped.values()].reduce((count, value) => count + value, 0);
  assert.ok(groupedProcessCount < 3239, 'identical low-level evidence commands must be grouped across leaves');
});
