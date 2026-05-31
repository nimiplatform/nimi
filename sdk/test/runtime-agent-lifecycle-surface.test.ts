import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentLifecycleStatus,
  createHostRuntimeAgentLifecycleSurface,
  createNimiError,
} from '../src/runtime/index.js';
import { ReasonCode } from '../src/types/index.js';

function createRuntime() {
  const calls = {
    registerApp: 0,
    authorizeExternalPrincipal: 0,
    getAgent: [] as Array<Record<string, unknown>>,
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
        getAgent: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.getAgent.push({ ...request, __options: options });
          throw createNimiError({
            message: 'not found',
            reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
            source: 'runtime',
          });
        },
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

test('host Runtime agent lifecycle surface ensures a missing local agent is initialized through SDK scope handling', async () => {
  const { calls, runtime } = createRuntime();
  const surface = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
  });

  await surface.ensureLocalAgentInitialized({
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    displayName: 'Agent One',
    worldId: 'world-1',
  });

  assert.equal(calls.registerApp, 1);
  assert.equal(calls.authorizeExternalPrincipal, 2);
  assert.deepEqual(calls.getAgent[0]?.context, {
    appId: 'sdk-test',
    subjectUserId: 'owner-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
  });
  assert.equal(calls.initializeAgent[0]?.displayName, 'Agent One');
  assert.equal(calls.initializeAgent[0]?.worldId, 'world-1');
  assert.ok(calls.getAgent[0]?.__options);
  assert.ok(calls.initializeAgent[0]?.__options);
});

test('host Runtime agent lifecycle surface does not reinitialize active local agents', async () => {
  const { calls, runtime } = createRuntime();
  runtime.agent.getAgent = async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
    calls.getAgent.push({ ...request, __options: options });
    return {
      agent: {
        lifecycleStatus: AgentLifecycleStatus.ACTIVE,
      },
    };
  };
  const surface = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'owner-1',
  });

  await surface.ensureLocalAgentInitialized({
    localAgentRef: 'local-agent:owner-1:agent-1',
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
  });

  assert.equal(calls.getAgent.length, 1);
  assert.equal(calls.initializeAgent.length, 0);
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
