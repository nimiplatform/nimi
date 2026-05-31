import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHostRuntimeAgentLifecycleSurface,
  createNimiError,
} from '../src/runtime/index.js';
import { ReasonCode } from '../src/types/index.js';

function createRuntime() {
  const calls = {
    registerApp: 0,
    authorizeExternalPrincipal: 0,
    initializeAgent: [] as Array<Record<string, unknown>>,
    terminateAgent: [] as Array<Record<string, unknown>>,
  };
  return {
    calls,
    runtime: {
      appId: 'sdk-test',
      auth: {
        registerApp: async () => {
          calls.registerApp += 1;
          return { accepted: true };
        },
      },
      appAuth: {
        authorizeExternalPrincipal: async () => {
          calls.authorizeExternalPrincipal += 1;
          return { tokenId: 'token-id', secret: 'token-secret' };
        },
      },
      agent: {
        initializeAgent: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.initializeAgent.push({ ...request, __options: options });
          return {};
        },
        terminateAgent: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.terminateAgent.push({ ...request, __options: options });
          return {};
        },
      },
    },
  };
}

test('host Runtime agent lifecycle surface initializes and terminates local agents with admin scope', async () => {
  const { calls, runtime } = createRuntime();
  const surface = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
  });

  await surface.initializeLocalAgent({
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
  });
  await surface.terminateLocalAgent({
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    reason: 'test-cleanup',
  });

  assert.equal(calls.registerApp, 1);
  assert.equal(calls.authorizeExternalPrincipal, 1);
  assert.deepEqual(calls.initializeAgent[0]?.context, {
    appId: 'sdk-test',
    subjectUserId: 'owner-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
  });
  assert.equal(calls.initializeAgent[0]?.displayName, 'agent-1');
  assert.equal(calls.terminateAgent[0]?.agentId, 'local-agent:owner-1:agent-1');
  assert.equal(calls.terminateAgent[0]?.reason, 'test-cleanup');
  assert.ok(calls.initializeAgent[0]?.__options);
  assert.ok(calls.terminateAgent[0]?.__options);
});

test('host Runtime agent lifecycle surface treats already-existing initialize as idempotent success', async () => {
  const { runtime } = createRuntime();
  runtime.agent.initializeAgent = async () => {
    throw createNimiError({
      message: 'already exists',
      reasonCode: 'RUNTIME_GRPC_ALREADY_EXISTS',
      source: 'runtime',
    });
  };
  const surface = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
  });

  await surface.initializeLocalAgent({
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
  });
});

test('host Runtime agent lifecycle surface propagates fail-closed lifecycle errors', async () => {
  const { runtime } = createRuntime();
  runtime.agent.initializeAgent = async () => {
    throw createNimiError({
      message: 'disk unavailable',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      source: 'runtime',
    });
  };
  const surface = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
  });

  await assert.rejects(() => surface.initializeLocalAgent({
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
  }), /disk unavailable/);
});
