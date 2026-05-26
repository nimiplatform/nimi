import assert from 'node:assert/strict';
import test from 'node:test';

import { clearPlatformClient, createPlatformClient } from '@nimiplatform/sdk';
import {
  RuntimeMethodIds,
  setNodeGrpcBridge,
} from '@nimiplatform/sdk/runtime';
import type {
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '@nimiplatform/sdk/runtime';
import {
  ResolveProfileRequest,
  ResolveProfileResponse,
} from '../../../sdk/src/runtime/generated/runtime/v1/local_runtime';

import { localRuntime } from '../src/runtime/local-runtime';

type CapturedRuntimeCall = RuntimeUnaryCall<RuntimeWireMessage>;

function installRuntimeLocalBridge(calls: CapturedRuntimeCall[]): () => void {
  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      calls.push(input);
      if (input.methodId === RuntimeMethodIds.local.resolveProfile) {
        return ResolveProfileResponse.toBinary(
          ResolveProfileResponse.create({
            plan: {
              planId: 'plan-balanced-fast',
              targetId: 'world.nimi.local-image',
              profileId: 'balanced-fast',
              title: 'Balanced Fast',
              recommended: true,
              consumeCapabilities: ['image'],
              executionPlan: {
                planId: 'plan-balanced-fast',
                targetId: 'world.nimi.local-image',
                capability: 'image',
                deviceProfile: {
                  os: 'darwin',
                  arch: 'arm64',
                  totalRamBytes: '0',
                  availableRamBytes: '0',
                  gpu: { available: true },
                  python: { available: true },
                  npu: { available: false, ready: false },
                  diskFreeBytes: '0',
                  ports: [],
                },
                entries: [],
                selectionRationale: [],
                preflightDecisions: [],
                warnings: [],
              },
              warnings: [],
            },
          }),
        );
      }
      throw new Error(`UNEXPECTED_RUNTIME_METHOD:${input.methodId}`);
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array(0);
      },
    }),
    closeStream: async () => {},
  });
  return () => {
    setNodeGrpcBridge(null);
    clearPlatformClient();
  };
}

async function createRuntimeLocalPlatformClient(): Promise<void> {
  await createPlatformClient({
    appId: 'nimi.desktop.test',
    realmBaseUrl: 'https://realm.test.local',
    accessToken: 'test-access-token',
    subjectUserIdProvider: () => 'test-user',
    runtimeTransport: { type: 'node-grpc', endpoint: '127.0.0.1:65535' },
    realmFetchImpl: async () => new Response('{}', { status: 200 }),
  });
}

test('resolveLocalRuntimeProfile forwards entryOverrides through SDK RuntimeLocalService', async () => {
  const calls: CapturedRuntimeCall[] = [];
  const restore = installRuntimeLocalBridge(calls);
  try {
    await createRuntimeLocalPlatformClient();
    const plan = await localRuntime.resolveProfile({
      targetId: 'world.nimi.local-image',
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
    assert.equal(calls[0]?.methodId, RuntimeMethodIds.local.resolveProfile);

    const request = ResolveProfileRequest.fromBinary(calls[0].request);
    assert.deepEqual(request.entryOverrides, [
      { entryId: 'text-encoder', localAssetId: 'asset-llm-1' },
      { entryId: 'image-vae', localAssetId: 'asset-vae-1' },
    ]);
  } finally {
    restore();
  }
});
