import assert from 'node:assert/strict';
import test from 'node:test';

import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store';
import { localAiRuntime } from '../src/runtime/local-ai-runtime';
import { createModLocalProfileSnapshotResolver } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-profiles.js';

test('profile snapshot resolver maps canonical capability tokens for mod-facing output', async () => {
  const originalGetState = useAppStore.getState;
  const originalResolveProfile = localAiRuntime.resolveProfile;
  const originalList = localAiRuntime.list;
  const originalListArtifacts = localAiRuntime.listArtifacts;
  const originalListServices = localAiRuntime.listServices;
  const originalListNodesCatalog = localAiRuntime.listNodesCatalog;

  const resolveProfileCalls: Array<Record<string, unknown>> = [];
  const listNodesCatalogCalls: Array<Record<string, unknown>> = [];

  useAppStore.getState = (() => ({
    localManifestSummaries: [{
      id: 'world.nimi.local-chat',
      manifest: {
        ai: {
          profiles: [{
            id: 'tts-default',
            title: 'TTS Default',
            recommended: true,
            consumeCapabilities: ['tts'],
            entries: [{
              entryId: 'local-chat/tts-qwen3-1.7b',
              kind: 'service',
              capability: 'tts',
              required: true,
              serviceId: 'qwen-tts-python',
            }],
          }],
        },
      },
    }],
  })) as typeof useAppStore.getState;

  localAiRuntime.resolveProfile = (async (input: Record<string, unknown>) => {
    resolveProfileCalls.push(input);
    return {
      planId: 'plan-local-chat',
      modId: 'world.nimi.local-chat',
      profileId: 'tts-default',
      title: 'TTS Default',
      recommended: true,
      consumeCapabilities: ['tts'],
      reasonCode: undefined,
      warnings: [],
      artifactEntries: [],
      executionPlan: {
        planId: 'plan-local-chat',
        modId: 'world.nimi.local-chat',
        capability: 'tts',
        deviceProfile: {
          os: 'darwin',
          arch: 'arm64',
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
          entryId: 'local-chat/tts-qwen3-1.7b',
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
  }) as unknown as typeof localAiRuntime.resolveProfile;
  localAiRuntime.list = (async () => []) as unknown as typeof localAiRuntime.list;
  localAiRuntime.listArtifacts = (async () => []) as unknown as typeof localAiRuntime.listArtifacts;
  localAiRuntime.listServices = (async () => [{
    serviceId: 'qwen-tts-python',
    status: 'active',
  }]) as unknown as typeof localAiRuntime.listServices;
  localAiRuntime.listNodesCatalog = (async (input?: Record<string, unknown>) => {
    listNodesCatalogCalls.push(input || {});
    return [];
  }) as unknown as typeof localAiRuntime.listNodesCatalog;

  try {
    const resolver = createModLocalProfileSnapshotResolver();
    const snapshot = await resolver({
      modId: 'world.nimi.local-chat',
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
    localAiRuntime.resolveProfile = originalResolveProfile;
    localAiRuntime.list = originalList;
    localAiRuntime.listArtifacts = originalListArtifacts;
    localAiRuntime.listServices = originalListServices;
    localAiRuntime.listNodesCatalog = originalListNodesCatalog;
  }
});
