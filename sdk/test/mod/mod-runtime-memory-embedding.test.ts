import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanonicalModAIScopeRef,
  createEmptyMemoryEmbeddingConfig,
  createModRuntimeClient,
} from '../../src/mod/runtime/index.js';
import { clearModSdkHost } from '../../src/mod/host.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-facade.js';

test('mod runtime client memory embedding bridge forwards canonical scope and normalizes payloads', async () => {
  clearModSdkHost();

  const modId = 'world.nimi.bridge.sdk.memory-embedding';
  const scopeRef = createCanonicalModAIScopeRef(modId);
  const request = {
    scopeRef,
    targetRef: {
      kind: 'agent-core' as const,
      agentId: 'agent-1',
    },
  };
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    memoryEmbeddingConfig: {
      get: (input: Record<string, unknown>) => {
        calls.push({ method: 'config.get', payload: input });
        return createEmptyMemoryEmbeddingConfig(scopeRef);
      },
      update: (input: Record<string, unknown>) => {
        calls.push({ method: 'config.update', payload: input });
      },
      subscribe: (input: Record<string, unknown>) => {
        calls.push({ method: 'config.subscribe', payload: input });
        return () => undefined;
      },
    },
    memoryEmbeddingRuntime: {
      inspect: async (input: Record<string, unknown>) => {
        calls.push({ method: 'runtime.inspect', payload: input });
        return {
          bindingIntentPresent: false,
          bindingSourceKind: null,
          resolutionState: 'missing' as const,
          resolvedProfileIdentity: null,
          canonicalBankStatus: 'unbound' as const,
          blockedReasonCode: null,
          operationReadiness: {
            bindAllowed: false,
            cutoverAllowed: false,
          },
        };
      },
      requestBind: async (input: Record<string, unknown>) => {
        calls.push({ method: 'runtime.bind', payload: input });
        return {
          outcome: 'rejected' as const,
          blockedReasonCode: 'RUNTIME_UNAVAILABLE',
          canonicalBankStatusAfter: 'unbound' as const,
          pendingCutover: false,
        };
      },
      requestCutover: async (input: Record<string, unknown>) => {
        calls.push({ method: 'runtime.cutover', payload: input });
        return {
          outcome: 'not_ready' as const,
          blockedReasonCode: 'RUNTIME_UNAVAILABLE',
          canonicalBankStatusAfter: 'unbound' as const,
        };
      },
    },
  };

  const client = createModRuntimeClient(modId, {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const config = client.memoryEmbeddingConfig.get(scopeRef);
  client.memoryEmbeddingConfig.update(scopeRef, {
    ...config,
    sourceKind: 'cloud',
    bindingRef: {
      kind: 'cloud',
      connectorId: 'conn-1',
      modelId: 'gemini-embedding-001',
    },
  });
  const unsubscribe = client.memoryEmbeddingConfig.subscribe(scopeRef, () => undefined);
  unsubscribe();
  const inspect = await client.memoryEmbeddingRuntime.inspect(request);
  const bind = await client.memoryEmbeddingRuntime.requestBind(request);
  const cutover = await client.memoryEmbeddingRuntime.requestCutover(request);

  assert.equal(inspect.resolutionState, 'missing');
  assert.equal(bind.outcome, 'rejected');
  assert.equal(cutover.outcome, 'not_ready');
  assert.deepEqual(calls.map((entry) => entry.method), [
    'config.get',
    'config.update',
    'config.subscribe',
    'runtime.inspect',
    'runtime.bind',
    'runtime.cutover',
  ]);
  for (const entry of calls) {
    assert.equal(entry.payload.modId, modId);
    if (entry.method.startsWith('runtime.')) {
      assert.deepEqual(entry.payload.request, request);
      continue;
    }
    assert.deepEqual(entry.payload.scopeRef, scopeRef);
  }
  const updateCall = calls.find((entry) => entry.method === 'config.update');
  assert.ok(updateCall);
  assert.deepEqual(
    (updateCall.payload.config as { scopeRef: unknown }).scopeRef,
    scopeRef,
  );
});

test('mod runtime client memory embedding bridge rejects noncanonical scopeRef', () => {
  clearModSdkHost();

  const modId = 'world.nimi.bridge.sdk.memory-embedding.explicit';
  let getCalls = 0;
  const runtimeHost = {
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    memoryEmbeddingConfig: {
      get: () => {
        getCalls += 1;
        return createEmptyMemoryEmbeddingConfig(createCanonicalModAIScopeRef(modId));
      },
      update: () => undefined,
      subscribe: () => () => undefined,
    },
    memoryEmbeddingRuntime: {
      inspect: async () => ({
        bindingIntentPresent: false,
        bindingSourceKind: null,
        resolutionState: 'missing' as const,
        resolvedProfileIdentity: null,
        canonicalBankStatus: 'unbound' as const,
        blockedReasonCode: null,
        operationReadiness: {
          bindAllowed: false,
          cutoverAllowed: false,
        },
      }),
      requestBind: async () => ({
        outcome: 'rejected' as const,
        blockedReasonCode: null,
        canonicalBankStatusAfter: 'unbound' as const,
        pendingCutover: false,
      }),
      requestCutover: async () => ({
        outcome: 'not_ready' as const,
        blockedReasonCode: null,
        canonicalBankStatusAfter: 'unbound' as const,
      }),
    },
  };

  const client = createModRuntimeClient(modId, {
    runtimeHost: runtimeHost as never,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  assert.throws(
    () => client.memoryEmbeddingConfig.get(undefined as never),
    /scopeRef is required/,
  );
  assert.throws(
    () => client.memoryEmbeddingConfig.get({ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }),
    /must equal mod:/,
  );
  assert.equal(getCalls, 0);
});
