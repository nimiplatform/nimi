import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createZhiyuRuntimeAgentAccessScopeRunner,
  resolveZhiyuRuntimeAgentAccessDecision,
  resolveZhiyuRuntimeAgentAccessDecisionFromHost,
  withZhiyuRuntimeAgentAccess,
} from '../src/shell/agent-chat/runtime-agent-access.ts';

test('Zhiyu Runtime Agent access fails closed without the host operation context', async () => {
  const decision = resolveZhiyuRuntimeAgentAccessDecision();
  assert.deepEqual(decision, {
    kind: 'missing',
    reasonCode: 'ZHIYU_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED',
    actionHint: 'attach_protected_local_app_carrier',
    message: 'Zhiyu Runtime Agent consumption requires the host-bound protected local-app carrier.',
  });
  await assert.rejects(
    withZhiyuRuntimeAgentAccess(decision, async () => 'unexpected'),
    (error) => error?.reasonCode === 'ZHIYU_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED',
  );
});

test('Zhiyu Runtime Agent access accepts only the host-bound protected local-app carrier', async () => {
  assert.deepEqual(resolveZhiyuRuntimeAgentAccessDecision({
    localAppCarrier: { kind: 'protected-local-app-carrier' },
  }), { kind: 'local-app-carrier' });
  assert.equal(resolveZhiyuRuntimeAgentAccessDecision({
    localAppCarrier: { kind: 'renderer-asserted-host' },
  }).kind, 'missing');
});

test('Zhiyu Runtime Agent access is resolved per operation and supplies no credential metadata', async () => {
  const previous = globalThis.__nimiZhiyuRuntimeAgentAccess;
  globalThis.__nimiZhiyuRuntimeAgentAccess = {
    localAppCarrier: { kind: 'protected-local-app-carrier' },
  };
  try {
    assert.deepEqual(resolveZhiyuRuntimeAgentAccessDecisionFromHost(), { kind: 'local-app-carrier' });
    const calls = [];
    const runner = createZhiyuRuntimeAgentAccessScopeRunner(
      resolveZhiyuRuntimeAgentAccessDecisionFromHost,
    );
    const result = await runner(['runtime.agent.turn.write'], async (options) => {
      calls.push(options);
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.deepEqual(calls, [{}]);

    delete globalThis.__nimiZhiyuRuntimeAgentAccess;
    await assert.rejects(
      runner(['runtime.agent.turn.write'], async () => 'unexpected'),
      (error) => error?.reasonCode === 'ZHIYU_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED',
    );
  } finally {
    if (previous === undefined) {
      delete globalThis.__nimiZhiyuRuntimeAgentAccess;
    } else {
      globalThis.__nimiZhiyuRuntimeAgentAccess = previous;
    }
  }
});
