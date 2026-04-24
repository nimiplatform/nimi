import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanonicalModAIScopeRef,
  createAIConfigEvidence,
  createEmptyAIConfig,
  createModRuntimeClient,
} from '../../src/mod/runtime/index.js';
import { clearModSdkHost } from '../../src/mod/host.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-facade.js';

test('mod runtime client aiConfig bridge forwards canonical scope CRUD and probe calls', async () => {
  clearModSdkHost();

  const modId = 'world.nimi.bridge.sdk.contract';
  const scopeRef = createCanonicalModAIScopeRef(modId);
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    aiConfig: {
      get: (input: Record<string, unknown>) => {
        calls.push({ method: 'get', payload: input });
        return createEmptyAIConfig(scopeRef);
      },
      update: (input: Record<string, unknown>) => {
        calls.push({ method: 'update', payload: input });
      },
      listScopes: (input: Record<string, unknown>) => {
        calls.push({ method: 'listScopes', payload: input });
        return [scopeRef];
      },
      probe: async (input: Record<string, unknown>) => {
        calls.push({ method: 'probe', payload: input });
        return { status: 'available', capabilityStatuses: {} };
      },
      probeFeasibility: async (input: Record<string, unknown>) => {
        calls.push({ method: 'probeFeasibility', payload: input });
        return { status: 'degraded', capabilityStatuses: {}, schedulingJudgement: null };
      },
      probeSchedulingTarget: async (input: Record<string, unknown>) => {
        calls.push({ method: 'probeSchedulingTarget', payload: input });
        return {
          state: 'queue_required',
          detail: 'slots occupied',
          occupancy: null,
          resourceWarnings: [],
        };
      },
      subscribe: (input: Record<string, unknown>) => {
        calls.push({ method: 'subscribe', payload: input });
        return () => undefined;
      },
    },
    aiSnapshot: {
      record: (input: Record<string, unknown>) => {
        calls.push({ method: 'snapshot.record', payload: input });
      },
      get: (input: Record<string, unknown>) => {
        calls.push({ method: 'snapshot.get', payload: input });
        return null;
      },
      getLatest: (input: Record<string, unknown>) => {
        calls.push({ method: 'snapshot.getLatest', payload: input });
        return null;
      },
    },
  };

  const client = createModRuntimeClient(modId, {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const config = client.aiConfig.get(scopeRef);
  client.aiConfig.update(scopeRef, config);
  assert.deepEqual(client.aiConfig.listScopes(), [scopeRef]);
  await client.aiConfig.probe(scopeRef);
  await client.aiConfig.probeFeasibility(scopeRef);
  await client.aiConfig.probeSchedulingTarget(scopeRef, {
    capability: 'text.generate',
    modId: 'core:runtime',
    profileId: 'text-local',
  });
  const unsubscribe = client.aiConfig.subscribe(scopeRef, () => undefined);
  unsubscribe();
  client.aiSnapshot.record(scopeRef, {
    executionId: 'exec-001',
    scopeRef,
    configEvidence: createAIConfigEvidence(createEmptyAIConfig(scopeRef)),
    conversationCapabilitySlice: {
      executionId: 'exec-001',
      createdAt: '2026-04-08T00:00:00.000Z',
      capability: 'text.generate',
      selectedBinding: null,
      resolvedBinding: null,
      health: null,
      metadata: null,
      agentResolution: null,
    },
    runtimeEvidence: null,
    createdAt: '2026-04-08T00:00:00.000Z',
  });
  assert.equal(client.aiSnapshot.get('exec-001'), null);
  assert.equal(client.aiSnapshot.getLatest(scopeRef), null);

  assert.deepEqual(calls.map((entry) => entry.method), [
    'get',
    'update',
    'listScopes',
    'probe',
    'probeFeasibility',
    'probeSchedulingTarget',
    'subscribe',
    'snapshot.record',
    'snapshot.get',
    'snapshot.getLatest',
  ]);
  for (const entry of calls) {
    if (entry.method === 'listScopes' || entry.method === 'snapshot.get') {
      assert.equal(entry.payload.modId, modId);
      continue;
    }
    assert.equal(entry.payload.modId, modId);
    assert.deepEqual(entry.payload.scopeRef, scopeRef);
  }
  const updateCall = calls.find((entry) => entry.method === 'update');
  assert.ok(updateCall);
  assert.deepEqual(
    (updateCall.payload.config as { scopeRef: unknown }).scopeRef,
    scopeRef,
  );
  const recordCall = calls.find((entry) => entry.method === 'snapshot.record');
  assert.ok(recordCall);
  assert.deepEqual(
    (recordCall.payload.snapshot as { scopeRef: unknown }).scopeRef,
    scopeRef,
  );
});

test('mod runtime client aiConfig bridge rejects missing and noncanonical scopeRef without host fallback', () => {
  clearModSdkHost();

  const modId = 'world.nimi.bridge.sdk.explicit';
  let getCalls = 0;
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    aiConfig: {
      get: () => {
        getCalls += 1;
        return createEmptyAIConfig(createCanonicalModAIScopeRef(modId));
      },
    },
    aiSnapshot: {
      record: () => undefined,
      get: () => null,
      getLatest: () => null,
    },
  };

  const client = createModRuntimeClient(modId, {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  assert.throws(
    () => client.aiConfig.get(undefined as never),
    /scopeRef is required/,
  );
  assert.throws(
    () => client.aiConfig.get({ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }),
    /must equal mod:/,
  );
  assert.throws(
    () => client.aiConfig.get({ kind: 'mod', ownerId: 'another.mod', surfaceId: 'workspace' }),
    /must equal mod:/,
  );
  assert.equal(getCalls, 0);
});

test('mod runtime client aiSnapshot getLatest requires canonical mod scopeRef', () => {
  clearModSdkHost();

  const modId = 'world.nimi.bridge.sdk.snapshot';
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    aiConfig: {
      get: () => createEmptyAIConfig(createCanonicalModAIScopeRef(modId)),
      update: () => undefined,
      listScopes: () => [],
      probe: async () => ({ status: 'unknown', capabilityStatuses: {} }),
      probeFeasibility: async () => ({ status: 'unknown', capabilityStatuses: {}, schedulingJudgement: null }),
      probeSchedulingTarget: async () => null,
      subscribe: () => () => undefined,
    },
    aiSnapshot: {
      record: () => undefined,
      get: () => null,
      getLatest: () => null,
    },
  };

  const client = createModRuntimeClient(modId, {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  assert.throws(
    () => client.aiSnapshot.getLatest({ kind: 'mod', ownerId: modId, surfaceId: 'not-workspace' }),
    /must equal mod:/,
  );
  assert.throws(
    () => client.aiSnapshot.record({ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }, {
      executionId: 'exec-invalid-001',
      scopeRef: { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' },
      configEvidence: createAIConfigEvidence(createEmptyAIConfig({ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' })),
      conversationCapabilitySlice: {
        executionId: 'exec-invalid-001',
        createdAt: '2026-04-08T00:00:00.000Z',
        capability: 'text.generate',
        selectedBinding: null,
        resolvedBinding: null,
        health: null,
        metadata: null,
        agentResolution: null,
      },
      runtimeEvidence: null,
      createdAt: '2026-04-08T00:00:00.000Z',
    }),
    /must equal mod:/,
  );
});
