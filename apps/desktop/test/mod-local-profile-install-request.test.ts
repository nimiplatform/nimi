import assert from 'node:assert/strict';
import test from 'node:test';

import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store';
import { localRuntime } from '../src/runtime/local-runtime';
import { buildRuntimeHostCapabilities } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.js';
import { ReasonCode } from '@nimiplatform/sdk/types';

function createHost() {
  return buildRuntimeHostCapabilities({
    checkLocalLlmHealth: async () => ({ healthy: true, status: 'healthy' }) as never,
    executeLocalKernelTurn: async () => ({ outputText: '' }) as never,
    withOpenApiContextLock: async (_context, task) => task(),
    getRuntimeHookRuntime: () => ({
      setModLocalProfileSnapshotResolver: () => {},
      authorizeRuntimeCapability: () => {},
    }) as never,
  });
}

function installWindowConfirm(confirm: (message?: string) => boolean): () => void {
  const globals = globalThis as unknown as {
    window?: Record<string, unknown> & { confirm?: (message?: string) => boolean };
  };
  const previous = globals.window;
  globals.window = { ...(previous || {}), confirm };
  return () => {
    if (previous) {
      globals.window = previous;
      return;
    }
    globals.window = undefined;
  };
}

test('requestProfileInstall resolves and applies only after host confirm acceptance', async () => {
  const originalGetState = useAppStore.getState;
  const originalResolveProfile = localRuntime.resolveProfile;
  const originalApplyProfile = localRuntime.applyProfile;

  let confirmMessage = '';
  const restoreWindow = installWindowConfirm((message) => {
    confirmMessage = message ?? '';
    return true;
  });

  useAppStore.getState = (() => ({
    ...originalGetState(),
    localManifestSummaries: [{
      id: 'world.nimi.local-image',
      path: '/mods/world.nimi.local-image/manifest.json',
      manifest: {
        ai: {
          profiles: [{
            id: 'balanced-fast',
            title: 'Balanced Fast',
            recommended: true,
            consumeCapabilities: ['image'],
            entries: [],
          }],
        },
      },
    }],
  })) as unknown as typeof useAppStore.getState;

  let resolved = 0;
  let applied = 0;
  let resolvedCapability = '';
  localRuntime.resolveProfile = (async (input?: Record<string, unknown>) => {
    resolved += 1;
    resolvedCapability = String(input?.capability || '');
    return {
      planId: 'plan-balanced-fast',
      modId: 'world.nimi.local-image',
      profileId: 'balanced-fast',
      title: 'Balanced Fast',
      recommended: true,
      consumeCapabilities: ['image'],
      executionPlan: {
        planId: 'plan-balanced-fast',
        modId: 'world.nimi.local-image',
        capability: 'image',
        deviceProfile: { os: 'darwin', arch: 'arm64', totalRamBytes: 0, availableRamBytes: 0, gpu: { available: true }, python: { available: true }, npu: { available: false, ready: false }, diskFreeBytes: 0, ports: [] },
        entries: [],
        selectionRationale: [],
        preflightDecisions: [],
        warnings: [],
      },
      assetEntries: [],
      warnings: [],
    };
  }) as unknown as typeof localRuntime.resolveProfile;
  localRuntime.applyProfile = (async () => {
    applied += 1;
    return {
      planId: 'plan-balanced-fast',
      modId: 'world.nimi.local-image',
      profileId: 'balanced-fast',
      executionResult: {
        planId: 'plan-balanced-fast',
        modId: 'world.nimi.local-image',
        entries: [],
        installedAssets: [],
        services: [],
        capabilities: [],
        stageResults: [],
        preflightDecisions: [],
        rollbackApplied: false,
        warnings: [],
      },
      installedAssets: [],
      warnings: [],
      reasonCode: ReasonCode.ACTION_EXECUTED,
    };
  }) as unknown as typeof localRuntime.applyProfile;

  try {
    const host = createHost();
    const result = await host.runtime.local.requestProfileInstall({
      modId: 'world.nimi.local-image',
      profileId: 'balanced-fast',
      capability: 'image',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.declined, false);
    assert.equal(resolved, 1);
    assert.equal(applied, 1);
    assert.equal(resolvedCapability, 'image');
    assert.match(confirmMessage, /Balanced Fast/);
  } finally {
    restoreWindow();
    useAppStore.getState = originalGetState;
    localRuntime.resolveProfile = originalResolveProfile;
    localRuntime.applyProfile = originalApplyProfile;
  }
});

test('getProfileInstallStatus forwards capability to local runtime profile status resolver', async () => {
  const originalGetState = useAppStore.getState;
  const originalGetProfileInstallStatus = localRuntime.getProfileInstallStatus;

  useAppStore.getState = (() => ({
    ...originalGetState(),
    localManifestSummaries: [{
      id: 'world.nimi.local-image',
      path: '/mods/world.nimi.local-image/manifest.json',
      manifest: {
        ai: {
          profiles: [{
            id: 'balanced-fast',
            title: 'Balanced Fast',
            recommended: true,
            consumeCapabilities: ['image', 'embedding'],
            entries: [],
          }],
        },
      },
    }],
  })) as unknown as typeof useAppStore.getState;

  let observedCapability = '';
  localRuntime.getProfileInstallStatus = (async (input?: Record<string, unknown>) => {
    observedCapability = String(input?.capability || '');
    return {
      modId: 'world.nimi.local-image',
      profileId: 'balanced-fast',
      status: 'ready',
      warnings: [],
      missingEntries: [],
      updatedAt: new Date(0).toISOString(),
    };
  }) as typeof localRuntime.getProfileInstallStatus;

  try {
    const host = createHost();
    const result = await host.runtime.local.getProfileInstallStatus({
      modId: 'world.nimi.local-image',
      profileId: 'balanced-fast',
      capability: 'image',
    });

    assert.equal(result.status, 'ready');
    assert.equal(observedCapability, 'image');
  } finally {
    useAppStore.getState = originalGetState;
    localRuntime.getProfileInstallStatus = originalGetProfileInstallStatus;
  }
});

test('requestProfileInstall returns declined without executing install when host confirm rejects', async () => {
  const originalGetState = useAppStore.getState;
  const originalResolveProfile = localRuntime.resolveProfile;
  const originalApplyProfile = localRuntime.applyProfile;
  const restoreWindow = installWindowConfirm(() => false);

  useAppStore.getState = (() => ({
    ...originalGetState(),
    localManifestSummaries: [{
      id: 'world.nimi.local-image',
      path: '/mods/world.nimi.local-image/manifest.json',
      manifest: {
        ai: {
          profiles: [{
            id: 'balanced-fast',
            title: 'Balanced Fast',
            recommended: true,
            consumeCapabilities: ['image'],
            entries: [],
          }],
        },
      },
    }],
  })) as unknown as typeof useAppStore.getState;

  let resolved = 0;
  let applied = 0;
  localRuntime.resolveProfile = (async () => {
    resolved += 1;
    throw new Error('UNEXPECTED_RESOLVE');
  }) as typeof localRuntime.resolveProfile;
  localRuntime.applyProfile = (async () => {
    applied += 1;
    throw new Error('UNEXPECTED_APPLY');
  }) as typeof localRuntime.applyProfile;

  try {
    const host = createHost();
    const result = await host.runtime.local.requestProfileInstall({
      modId: 'world.nimi.local-image',
      profileId: 'balanced-fast',
      confirmMessage: 'Install this profile?',
    });

    assert.equal(result.accepted, false);
    assert.equal(result.declined, true);
    assert.equal(result.reasonCode, ReasonCode.LOCAL_AI_PROFILE_INSTALL_DECLINED);
    assert.equal(resolved, 0);
    assert.equal(applied, 0);
  } finally {
    restoreWindow();
    useAppStore.getState = originalGetState;
    localRuntime.resolveProfile = originalResolveProfile;
    localRuntime.applyProfile = originalApplyProfile;
  }
});

test('requestProfileInstall returns LOCAL_AI_PROFILE_NOT_FOUND when the selected profile is absent', async () => {
  const originalGetState = useAppStore.getState;
  const originalResolveProfile = localRuntime.resolveProfile;
  const originalApplyProfile = localRuntime.applyProfile;
  const restoreWindow = installWindowConfirm(() => {
    throw new Error('UNEXPECTED_CONFIRM');
  });

  useAppStore.getState = (() => ({
    ...originalGetState(),
    localManifestSummaries: [{
      id: 'world.nimi.local-image',
      path: '/mods/world.nimi.local-image/manifest.json',
      manifest: {
        ai: {
          profiles: [{
            id: 'balanced-fast',
            title: 'Balanced Fast',
            recommended: true,
            consumeCapabilities: ['image'],
            entries: [],
          }],
        },
      },
    }],
  })) as unknown as typeof useAppStore.getState;

  let resolved = 0;
  let applied = 0;
  localRuntime.resolveProfile = (async () => {
    resolved += 1;
    throw new Error('UNEXPECTED_RESOLVE');
  }) as typeof localRuntime.resolveProfile;
  localRuntime.applyProfile = (async () => {
    applied += 1;
    throw new Error('UNEXPECTED_APPLY');
  }) as typeof localRuntime.applyProfile;

  try {
    const host = createHost();
    const result = await host.runtime.local.requestProfileInstall({
      modId: 'world.nimi.local-image',
      profileId: 'missing-profile',
    });

    assert.equal(result.accepted, false);
    assert.equal(result.declined, false);
    assert.equal(result.reasonCode, ReasonCode.LOCAL_AI_PROFILE_NOT_FOUND);
    assert.equal(resolved, 0);
    assert.equal(applied, 0);
  } finally {
    restoreWindow();
    useAppStore.getState = originalGetState;
    localRuntime.resolveProfile = originalResolveProfile;
    localRuntime.applyProfile = originalApplyProfile;
  }
});
