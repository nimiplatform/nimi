import assert from 'node:assert/strict';
import test from 'node:test';

import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store';
import { localRuntime } from '../src/runtime/local-runtime';
import { createModLocalProfileSnapshotResolver } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-profiles.js';

test('profile snapshot resolver maps canonical capability tokens for mod-facing output', async () => {
  const originalGetState = useAppStore.getState;
  const originalResolveProfile = localRuntime.resolveProfile;
  const originalListAssets = localRuntime.listAssets;
  const originalListServices = localRuntime.listServices;
  const originalListNodesCatalog = localRuntime.listNodesCatalog;

  const resolveProfileCalls: Array<Record<string, unknown>> = [];
  const listNodesCatalogCalls: Array<Record<string, unknown>> = [];

  useAppStore.getState = (() => ({
    ...originalGetState(),
    localManifestSummaries: [{
      id: 'world.nimi.test-ai',
      path: '/mods/world.nimi.test-ai/manifest.json',
      manifest: {
        ai: {
          profiles: [{
            id: 'tts-default',
            title: 'TTS Default',
            recommended: true,
            consumeCapabilities: ['tts'],
            entries: [{
              entryId: 'test-ai/tts-qwen3-1.7b',
              kind: 'service',
              capability: 'tts',
              required: true,
              serviceId: 'qwen-tts-python',
            }],
          }],
        },
      },
    }],
  })) as unknown as typeof useAppStore.getState;

  localRuntime.resolveProfile = (async (input: Record<string, unknown>) => {
    resolveProfileCalls.push(input);
    return {
      planId: 'plan-test-ai',
      modId: 'world.nimi.test-ai',
      profileId: 'tts-default',
      title: 'TTS Default',
      recommended: true,
      consumeCapabilities: ['tts'],
      reasonCode: undefined,
      warnings: [],
      assetEntries: [],
      executionPlan: {
        planId: 'plan-test-ai',
        modId: 'world.nimi.test-ai',
        capability: 'tts',
        deviceProfile: {
          os: 'darwin',
          arch: 'arm64',
          totalRamBytes: 0,
          availableRamBytes: 0,
          gpu: { available: true },
          python: { available: true },
          npu: { available: false, ready: false },
          diskFreeBytes: 0,
          ports: [],
        },
        warnings: [],
        selectionRationale: [],
        preflightDecisions: [],
        entries: [{
          entryId: 'test-ai/tts-qwen3-1.7b',
          kind: 'service',
          capability: 'tts',
          required: true,
          selected: true,
          preferred: true,
          serviceId: 'qwen-tts-python',
          warnings: [],
        }],
      },
    };
  }) as unknown as typeof localRuntime.resolveProfile;
  localRuntime.listAssets = (async () => []) as unknown as typeof localRuntime.listAssets;
  localRuntime.listServices = (async () => [{
    serviceId: 'qwen-tts-python',
    status: 'active',
  }]) as unknown as typeof localRuntime.listServices;
  localRuntime.listNodesCatalog = (async (input?: Record<string, unknown>) => {
    listNodesCatalogCalls.push(input || {});
    return [];
  }) as unknown as typeof localRuntime.listNodesCatalog;

  try {
    const resolver = createModLocalProfileSnapshotResolver();
    const snapshot = await resolver({
      modId: 'world.nimi.test-ai',
      capability: 'audio.synthesize',
      routeSourceHint: 'local',
    });

    assert.equal(resolveProfileCalls.length, 1);
    assert.equal(resolveProfileCalls[0]?.capability, 'tts');
    assert.equal(listNodesCatalogCalls.length, 1);
    assert.equal(listNodesCatalogCalls[0]?.capability, 'tts');
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.entries[0]?.capability, 'audio.synthesize');
  } finally {
    useAppStore.getState = originalGetState;
    localRuntime.resolveProfile = originalResolveProfile;
    localRuntime.listAssets = originalListAssets;
    localRuntime.listServices = originalListServices;
    localRuntime.listNodesCatalog = originalListNodesCatalog;
  }
});
