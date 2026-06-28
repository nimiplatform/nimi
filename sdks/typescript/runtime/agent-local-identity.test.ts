import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeAgentRequestContext,
  isRuntimeLocalAgentRef,
  projectRuntimeLocalAgentIdentity,
} from './agent-local-identity';

test('runtime local agent identity requires explicit opaque localAgentRef', () => {
  assert.deepEqual(projectRuntimeLocalAgentIdentity({
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:opaque-1',
  }), {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:opaque-1',
  });
});

test('runtime local agent identity validates explicit refs without inventing identity', () => {
  assert.deepEqual(projectRuntimeLocalAgentIdentity({
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: ' local-agent:opaque-1 ',
  }), {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:opaque-1',
  });
  assert.equal(isRuntimeLocalAgentRef(' local-agent:opaque-1 '), true);
  assert.equal(isRuntimeLocalAgentRef('agent-1'), false);
});

test('runtime local agent identity builds Runtime Agent request contexts', () => {
  assert.deepEqual(buildRuntimeAgentRequestContext({
    runtimeAppId: ' desktop ',
    subjectUserId: ' user-1 ',
    ownerUserId: ' user-1 ',
    runtimeSourceRef: ' agent-1 ',
    localAgentRef: 'local-agent:opaque-1',
  }), {
    appId: 'desktop',
    subjectUserId: 'user-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:opaque-1',
  });
});

test('runtime local agent identity fails closed on missing or mismatched parts', () => {
  assert.throws(
    () => projectRuntimeLocalAgentIdentity({
      ownerUserId: '',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'AI_INPUT_INVALID');
      assert.match(String((error as Error).message), /ownerUserId/);
      return true;
    },
  );
  assert.throws(
    () => projectRuntimeLocalAgentIdentity({
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'agent-1',
    }),
    /localAgentRef is malformed/,
  );
  assert.throws(
    () => buildRuntimeAgentRequestContext({
      runtimeAppId: 'desktop',
      subjectUserId: '',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    }),
    /subjectUserId/,
  );
});
