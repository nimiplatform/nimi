import assert from 'node:assert/strict';
import test from 'node:test';

import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store';
import { localAiRuntime } from '../src/runtime/local-ai-runtime';
import { createModAiDependencySnapshotResolver } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-dependencies.js';

test('dependency snapshot resolver maps canonical capability tokens for mod-facing output', async () => {
  const originalGetState = useAppStore.getState;
  const originalCollectDeviceProfile = localAiRuntime.collectDeviceProfile;
  const originalResolveDependencies = localAiRuntime.resolveDependencies;
  const originalList = localAiRuntime.list;
  const originalListServices = localAiRuntime.listServices;
  const originalListNodesCatalog = localAiRuntime.listNodesCatalog;

  const resolveDependencyCalls: Array<Record<string, unknown>> = [];
  const listNodesCatalogCalls: Array<Record<string, unknown>> = [];

  useAppStore.getState = (() => ({
    localManifestSummaries: [{
      id: 'world.nimi.local-chat',
      manifest: {
        ai: {
          dependencies: {
            defaults: {
              chat: 'local-chat/chat-qwen2.5-7b',
            },
          },
        },
      },
    }],
  })) as typeof useAppStore.getState;

  localAiRuntime.collectDeviceProfile = (async () => ({})) as unknown as typeof localAiRuntime.collectDeviceProfile;
  localAiRuntime.resolveDependencies = (async (input: Record<string, unknown>) => {
    resolveDependencyCalls.push(input);
    return {
      planId: 'plan-local-chat',
      reasonCode: undefined,
      warnings: [],
      preflightDecisions: [],
      dependencies: [{
        dependencyId: 'local-chat/tts-qwen3-1.7b',
        kind: 'service',
        capability: 'tts',
        required: true,
        selected: true,
        preferred: true,
        serviceId: 'qwen-tts-python',
        warnings: [],
      }],
    };
  }) as unknown as typeof localAiRuntime.resolveDependencies;
  localAiRuntime.list = (async () => []) as unknown as typeof localAiRuntime.list;
  localAiRuntime.listServices = (async () => [{
    serviceId: 'qwen-tts-python',
    status: 'active',
  }]) as unknown as typeof localAiRuntime.listServices;
  localAiRuntime.listNodesCatalog = (async (input?: Record<string, unknown>) => {
    listNodesCatalogCalls.push(input || {});
    return [];
  }) as unknown as typeof localAiRuntime.listNodesCatalog;

  try {
    const resolver = createModAiDependencySnapshotResolver();
    const snapshot = await resolver({
      modId: 'world.nimi.local-chat',
      capability: 'audio.synthesize',
      routeSourceHint: 'local-runtime',
    });

    assert.equal(resolveDependencyCalls.length, 1);
    assert.equal(resolveDependencyCalls[0]?.capability, 'tts');
    assert.equal(listNodesCatalogCalls.length, 1);
    assert.equal(listNodesCatalogCalls[0]?.capability, 'tts');
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.dependencies[0]?.capability, 'audio.synthesize');
  } finally {
    useAppStore.getState = originalGetState;
    localAiRuntime.collectDeviceProfile = originalCollectDeviceProfile;
    localAiRuntime.resolveDependencies = originalResolveDependencies;
    localAiRuntime.list = originalList;
    localAiRuntime.listServices = originalListServices;
    localAiRuntime.listNodesCatalog = originalListNodesCatalog;
  }
});
