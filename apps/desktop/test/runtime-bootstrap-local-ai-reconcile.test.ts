import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileLocalAiRuntimeBootstrapState } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-local-ai.js';

test('reconcileLocalAiRuntimeBootstrapState reconciles desktop and go-runtime models on startup', async () => {
  const desktopModels = [{
    localModelId: '01JMODEL',
    modelId: 'local-import/z_image_turbo-q4_k',
    capabilities: ['image'],
    engine: 'localai',
    entry: 'z_image_turbo-Q4_K.gguf',
    license: 'apache-2.0',
    source: {
      repo: 'repo',
      revision: 'main',
    },
    hashes: {},
    endpoint: 'http://127.0.0.1:1234/v1',
    status: 'installed' as const,
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
  }];
  const logs: Array<Record<string, unknown>> = [];
  const result = await reconcileLocalAiRuntimeBootstrapState({
    flowId: 'flow-bootstrap',
    deps: {
      listDesktopModels: async () => desktopModels,
      reconcileModels: async (models) => {
        assert.deepEqual(models, desktopModels);
        return {
          reconciled: [{
            action: 'reconcile',
            modelId: 'local-import/z_image_turbo-q4_k',
            engine: 'localai',
            localModelId: '01JMODEL',
            status: 'active',
            matchedBy: 'modelId+engine',
          }],
          adopted: [],
        };
      },
      log: (payload) => {
        logs.push(payload as Record<string, unknown>);
      },
    },
  });

  assert.equal(result.reconciled.length, 1);
  assert.equal(logs[0]?.message, 'phase:local-runtime-reconcile:done');
});

test('reconcileLocalAiRuntimeBootstrapState degrades gracefully when startup reconcile fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const result = await reconcileLocalAiRuntimeBootstrapState({
    deps: {
      listDesktopModels: async () => [],
      reconcileModels: async () => {
        throw new Error('grpc unavailable');
      },
      log: (payload) => {
        logs.push(payload as Record<string, unknown>);
      },
    },
  });

  assert.deepEqual(result, {
    reconciled: [],
    adopted: [],
  });
  assert.equal(logs[0]?.level, 'warn');
  assert.equal(logs[0]?.message, 'phase:local-runtime-reconcile:failed');
});
