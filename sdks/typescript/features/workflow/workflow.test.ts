import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../../core-client';
import { createRealm } from '../../realm';
import type { CoreStreamRequest, CoreUnaryRequest } from '../../types';
import {
  createWorldWorkflowPlan,
  executeWorldWorkflowPlan,
  listWorldCharactersStep,
  listWorldCoresStep,
  oasisWorldStep,
  worldCharacterStep,
  worldCoreStep,
} from './index';

class FakeWorldRealmTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.methodId === 'WorldCoreController_listWorldCores') {
      return [{ id: 'world-1', visibility: 'public' }] as Response;
    }
    if (request.methodId === 'WorldCoreController_listWorldCharacters') {
      return [{ id: 'character-1', worldId: 'world-1' }] as Response;
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
      oasisWorldStep(),
      worldCoreStep('world-1'),
      listWorldCharactersStep('world-1'),
      worldCharacterStep('character-1'),
      listWorldCoresStep({ visibility: 'public', take: 2 }),
    ],
  });

  const result = await executeWorldWorkflowPlan(realm, plan);

  assert.deepEqual(
    transport.unaryCalls.map((call) => call.methodId),
    [
      'WorldCoreController_getOasisWorld',
      'WorldCoreController_getWorldCore',
      'WorldCoreController_listWorldCharacters',
      'WorldCoreController_getWorldCharacter',
      'WorldCoreController_listWorldCores',
    ],
  );
  assert.deepEqual(transport.unaryCalls[2]?.body, {
    path: { worldId: 'world-1' },
  });
  assert.deepEqual(transport.unaryCalls[4]?.body, {
    path: {},
    query: { visibility: 'public', take: 2 },
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
    ['oasis-world', 'world-core', 'world-character-list', 'world-character', 'world-core-list'],
  );
});

test('world workflow fails closed for invalid plans and inputs', () => {
  assert.throws(
    () => createWorldWorkflowPlan({ planId: '', steps: [oasisWorldStep()] }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_WORLD_WORKFLOW_INPUT_INVALID',
  );

  assert.throws(
    () => worldCoreStep('   '),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_WORLD_WORKFLOW_INPUT_INVALID',
  );

  assert.throws(
    () => listWorldCoresStep({ take: -1 }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_WORLD_WORKFLOW_STEP_INVALID',
  );
});
