import assert from 'node:assert/strict';
import test from 'node:test';

import { withNimiRuntimeAgentScopes } from './runtime-agent-protected';

const runtime = {
  appId: 'nimi.desktop',
  auth: {},
};

test('protected Agent calls fail closed without a host operation-context runner', async () => {
  let operationCalled = false;

  await assert.rejects(
    withNimiRuntimeAgentScopes({
      runtime,
      subjectUserId: 'user-1',
    }, ['runtime.agent.write'], async () => {
      operationCalled = true;
      return 'unexpected';
    }),
    (error: unknown) =>
      (error as { readonly reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED',
  );

  assert.equal(operationCalled, false);
});

test('protected Agent calls use only the supplied host operation-context runner', async () => {
  const scopeCalls: Array<readonly string[]> = [];
  const result = await withNimiRuntimeAgentScopes({
    runtime,
    subjectUserId: 'user-1',
    withScopes: async (scopes, operation) => {
      scopeCalls.push(scopes);
      return operation({});
    },
  }, ['runtime.agent.read'], async () => 'operation-ran');

  assert.deepEqual(scopeCalls, [['runtime.agent.read']]);
  assert.equal(result, 'operation-ran');
});
