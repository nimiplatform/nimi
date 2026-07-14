import assert from 'node:assert/strict';
import test from 'node:test';

import { withNimiRuntimeAgentScopes } from './runtime-agent-protected';

const runtime = {
  appId: 'nimi.desktop',
  auth: {
    registerApp: async () => ({ accepted: true }),
  },
};

test('protected Agent calls fail closed without a Runtime-owned scope runner', async () => {
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
      (error as { readonly reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_SCOPED_CARRIER_REQUIRED',
  );

  assert.equal(operationCalled, false);
});

test('protected Agent calls use only the supplied Runtime-owned scope runner', async () => {
  const scopeCalls: Array<readonly string[]> = [];
  const result = await withNimiRuntimeAgentScopes({
    runtime,
    subjectUserId: 'user-1',
    withScopes: async (scopes, operation) => {
      scopeCalls.push(scopes);
      return operation({
        metadata: {
          'x-nimi-runtime-host-equivalence': 'desktop-protected-carrier',
        },
      });
    },
  }, ['runtime.agent.read'], async (options) => options.metadata?.['x-nimi-runtime-host-equivalence']);

  assert.deepEqual(scopeCalls, [['runtime.agent.read']]);
  assert.equal(result, 'desktop-protected-carrier');
});
