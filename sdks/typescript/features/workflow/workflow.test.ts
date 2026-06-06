import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../../core-client';
import { createRealm } from '../../realm';
import type { CoreStreamRequest, CoreUnaryRequest } from '../../types';
import {
  createWorldWorkflowPlan,
  executeWorldWorkflowPlan,
  listWorldsStep,
  mainWorldStep,
  worldDetailWithAgentsStep,
  worldHistoryStep,
  worldSummaryStep,
} from './index';

class FakeWorldRealmTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.methodId === 'WorldController_listWorlds') {
      return [{ id: 'world-1', status: 'ACTIVE' }] as Response;
    }
    if (request.methodId === 'WorldController_getWorldHistory') {
      return { items: [{ id: 'history-1' }] } as Response;
    }
    return { id: 'world-1', methodId: request.methodId } as Response;
  }

  async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
    throw new Error('World workflow must use Realm unary operations');
  }
}

test('world workflow executes through generated Realm world methods', async () => {
  const transport = new FakeWorldRealmTransport();
  const realm = createRealm({ transport });
  const plan = createWorldWorkflowPlan({
    planId: 'world-read-plan',
    steps: [
      mainWorldStep(),
      worldSummaryStep('world-1'),
      worldDetailWithAgentsStep({ worldId: 'world-1', recommendedAgentLimit: 2 }),
      worldHistoryStep('world-1'),
      listWorldsStep('ACTIVE'),
    ],
  });

  const result = await executeWorldWorkflowPlan(realm, plan);

  assert.deepEqual(
    transport.unaryCalls.map((call) => call.methodId),
    [
      'WorldController_getMainWorld',
      'WorldController_getWorld',
      'WorldController_getWorldDetailWithAgents',
      'WorldController_getWorldHistory',
      'WorldController_listWorlds',
    ],
  );
  assert.deepEqual(transport.unaryCalls[2]?.body, {
    path: { id: 'world-1' },
    query: { recommendedAgentLimit: 2 },
  });
  assert.deepEqual(transport.unaryCalls[4]?.body, {
    path: {},
    query: { status: 'ACTIVE' },
  });
  assert.deepEqual(
    result.events.map((event) => event.type),
    [
      'world.workflow.started',
      'world.workflow.step.completed',
      'world.workflow.step.completed',
      'world.workflow.step.completed',
      'world.workflow.step.completed',
      'world.workflow.step.completed',
      'world.workflow.completed',
    ],
  );
  assert.deepEqual(
    result.results.map((entry) => entry.kind),
    ['main-world', 'world-summary', 'world-detail-with-agents', 'world-history', 'world-list'],
  );
});

test('world workflow fails closed for invalid plans and inputs', () => {
  assert.throws(
    () => createWorldWorkflowPlan({ planId: '', steps: [mainWorldStep()] }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_WORLD_WORKFLOW_INPUT_INVALID',
  );

  assert.throws(
    () => worldSummaryStep('   '),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_WORLD_WORKFLOW_INPUT_INVALID',
  );

  assert.throws(
    () => worldDetailWithAgentsStep({ worldId: 'world-1', recommendedAgentLimit: -1 }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_WORLD_WORKFLOW_STEP_INVALID',
  );
});
