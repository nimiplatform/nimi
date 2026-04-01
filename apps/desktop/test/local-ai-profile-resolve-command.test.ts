import assert from 'node:assert/strict';
import test from 'node:test';

import { localRuntime } from '../src/runtime/local-runtime';

type TauriInvokeCall = {
  command: string;
  payload: Record<string, unknown>;
};

type MutableGlobalTauri = Record<string, unknown> & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
    listen?: () => () => void;
  };
  window?: Record<string, unknown> & {
    __NIMI_TAURI_TEST__?: {
      invoke?: (command: string, payload?: unknown) => Promise<unknown>;
      listen?: () => () => void;
    };
  };
};

function unwrapPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const root = payload as Record<string, unknown>;
  return root.payload && typeof root.payload === 'object' && !Array.isArray(root.payload)
    ? root.payload as Record<string, unknown>
    : {};
}

function installTauriRuntime(calls: TauriInvokeCall[]): () => void {
  const target = globalThis as unknown as MutableGlobalTauri;
  const previousRoot = target.__NIMI_TAURI_TEST__;
  const previousWindow = target.window;
  const invoke = async (command: string, payload?: unknown): Promise<unknown> => {
    const normalizedPayload = unwrapPayload(payload);
    calls.push({ command, payload: normalizedPayload });
    if (command === 'runtime_local_profiles_resolve') {
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
          entries: [],
          selectionRationale: [],
          preflightDecisions: [],
          warnings: [],
        },
        assetEntries: [],
        warnings: [],
      };
    }
    throw new Error(`UNEXPECTED_TAURI_COMMAND: ${command}`);
  };
  const runtime = {
    invoke,
    listen: () => () => {},
  };
  const windowObject = previousWindow || {};
  windowObject.__NIMI_TAURI_TEST__ = runtime;
  target.__NIMI_TAURI_TEST__ = runtime;
  target.window = windowObject;
  return () => {
    if (typeof previousRoot === 'undefined') {
      delete target.__NIMI_TAURI_TEST__;
    } else {
      target.__NIMI_TAURI_TEST__ = previousRoot;
    }
    if (typeof previousWindow === 'undefined') {
      target.window = undefined;
    } else {
      target.window = previousWindow;
    }
  };
}

test('resolveLocalRuntimeProfile forwards entryOverrides to the tauri command payload', async () => {
  const calls: TauriInvokeCall[] = [];
  const restore = installTauriRuntime(calls);
  try {
    const plan = await localRuntime.resolveProfile({
      modId: 'world.nimi.local-image',
      capability: 'image',
      profile: {
        id: 'balanced-fast',
        title: 'Balanced Fast',
        recommended: true,
        consumeCapabilities: ['image'],
        entries: [],
      },
      entryOverrides: [
        { entryId: 'text-encoder', localAssetId: 'asset-llm-1' },
        { entryId: 'image-vae', localAssetId: 'asset-vae-1' },
      ],
    });

    assert.equal(plan.profileId, 'balanced-fast');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, 'runtime_local_profiles_resolve');
    assert.deepEqual(calls[0]?.payload.entryOverrides, [
      { entryId: 'text-encoder', localAssetId: 'asset-llm-1' },
      { entryId: 'image-vae', localAssetId: 'asset-vae-1' },
    ]);
  } finally {
    restore();
  }
});
