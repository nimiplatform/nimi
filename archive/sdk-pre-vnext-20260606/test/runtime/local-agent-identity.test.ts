import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeAgentRequestContext,
  buildRuntimeLocalAgentRef,
  isRuntimeLocalAgentRef,
  parseRuntimeLocalAgentIdentity,
  projectRuntimeLocalAgentIdentity,
} from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';

test('runtime local agent identity builds the deterministic owner-scoped ref', () => {
  assert.equal(
    buildRuntimeLocalAgentRef({ ownerUserId: ' owner-1 ', realmAgentId: ' agent-1 ' }),
    'local-agent:owner-1:agent-1',
  );
  assert.deepEqual(projectRuntimeLocalAgentIdentity({
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
  }), {
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
  });
});

test('runtime local agent identity validates explicit refs without inventing alternate identity', () => {
  assert.deepEqual(projectRuntimeLocalAgentIdentity({
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: ' local-agent:owner-1:agent-1 ',
  }), {
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
  });

  assert.equal(isRuntimeLocalAgentRef(' local-agent:owner-1:agent-1 '), true);
  assert.equal(isRuntimeLocalAgentRef('agent-1'), false);
  assert.deepEqual(parseRuntimeLocalAgentIdentity(' local-agent:owner-1:agent-1 '), {
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
  });
});

test('runtime local agent identity builds agent request contexts', () => {
  assert.deepEqual(buildRuntimeAgentRequestContext({
    runtimeAppId: ' desktop ',
    subjectUserId: ' user-1 ',
    localAgentRef: 'local-agent:user-1:agent-1',
  }), {
    appId: 'desktop',
    subjectUserId: 'user-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
  });
});

test('runtime local agent identity fails closed on missing or mismatched identity parts', () => {
  assert.throws(
    () => buildRuntimeLocalAgentRef({ ownerUserId: '', realmAgentId: 'agent-1' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.AI_INPUT_INVALID);
      assert.match(String((error as Error).message), /ownerUserId/);
      return true;
    },
  );
  assert.throws(
    () => projectRuntimeLocalAgentIdentity({
      ownerUserId: 'owner-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:owner-2:agent-1',
    }),
    /must match ownerUserId and realmAgentId/,
  );
  assert.throws(
    () => projectRuntimeLocalAgentIdentity({
      ownerUserId: 'owner-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'agent-1',
    }),
    /localAgentRef is malformed/,
  );
  assert.throws(
    () => buildRuntimeAgentRequestContext({
      runtimeAppId: 'desktop',
      subjectUserId: '',
      localAgentRef: 'local-agent:owner-1:agent-1',
    }),
    /subjectUserId/,
  );
});
