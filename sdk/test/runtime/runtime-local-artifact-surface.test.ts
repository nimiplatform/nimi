import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPlatformClient,
  createPlatformClient,
} from '../../src/platform-client.js';
import {
  RuntimeLocalAnonymousMethodIds,
  RuntimeMethodIds,
  RuntimeWriteMethodIds,
  isRuntimeLocalAnonymousMethod,
  isRuntimeWriteMethod,
} from '../../src/runtime/method-ids.js';
import {
  bindLocalRuntimeServiceClientProvider,
  localRuntime,
} from '../../src/runtime/local-runtime-client/index.js';
import {
  buildLocalImageWorkflowExtensions,
  buildLocalProfileExtensions,
} from '../../src/runtime/runtime-media.js';
import {
  ResolveProfileRequest,
  ResolveProfileResponse,
} from '../../src/runtime/generated/runtime/v1/local_runtime.js';
import { setNodeGrpcBridge } from '../../src/runtime/transports/node-grpc.js';
import type {
  RuntimeUnaryCall,
  RuntimeWireMessage,
} from '../../src/runtime/types.js';

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

async function createRuntimeLocalPlatformClient(): Promise<() => void> {
  const client = await createPlatformClient({
    appId: 'nimi.sdk.runtime-local.test',
    authMode: 'external-principal',
    realmBaseUrl: 'https://realm.test.local',
    accessToken: 'test-access-token',
    subjectUserIdProvider: () => 'test-user',
    runtimeTransport: { type: 'node-grpc', endpoint: '127.0.0.1:65535' },
    realmFetchImpl: async () => new Response('{}', { status: 200 }),
  });
  return bindLocalRuntimeServiceClientProvider(() => client.runtime.local);
}

test('runtime method groups classify local asset RPCs correctly', () => {
  const anonymousMethods = [
    RuntimeMethodIds.local.listLocalAssets,
    RuntimeMethodIds.local.listVerifiedAssets,
  ];
  const writeMethods = [
    RuntimeMethodIds.local.installVerifiedAsset,
    RuntimeMethodIds.local.importLocalAsset,
    RuntimeMethodIds.local.removeLocalAsset,
  ];

  for (const methodId of anonymousMethods) {
    assert.equal(RuntimeLocalAnonymousMethodIds.includes(methodId), true);
    assert.equal(isRuntimeLocalAnonymousMethod(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), false);
  }

  for (const methodId of writeMethods) {
    assert.equal(RuntimeWriteMethodIds.includes(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), true);
    assert.equal(isRuntimeLocalAnonymousMethod(methodId), false);
  }
});

test('buildLocalImageWorkflowExtensions normalizes component selections and preserves unrelated extensions', () => {
  const extensions = buildLocalImageWorkflowExtensions(
    {
      components: [
        { slot: '  vae_path  ', localArtifactId: ' local-vae ' },
        { slot: 'llm_path', localArtifactId: 'local-llm' },
        { slot: '', localArtifactId: 'ignored-empty-slot' },
        { slot: 'clip_l_path', localArtifactId: '' },
      ],
      profileOverrides: {
        step: 8,
      },
    },
    {
      preserved: true,
    },
  );

  assert.deepEqual(extensions, {
    preserved: true,
    components: [
      { slot: 'vae_path', localArtifactId: 'local-vae' },
      { slot: 'llm_path', localArtifactId: 'local-llm' },
    ],
    profile_overrides: {
      step: 8,
    },
  });
});

test('runtime method groups classify local profile RPCs correctly', () => {
  assert.equal(RuntimeLocalAnonymousMethodIds.includes(RuntimeMethodIds.local.resolveProfile), true);
  assert.equal(isRuntimeLocalAnonymousMethod(RuntimeMethodIds.local.resolveProfile), true);
  assert.equal(isRuntimeWriteMethod(RuntimeMethodIds.local.resolveProfile), false);

  assert.equal(RuntimeWriteMethodIds.includes(RuntimeMethodIds.local.applyProfile), true);
  assert.equal(isRuntimeWriteMethod(RuntimeMethodIds.local.applyProfile), true);
  assert.equal(isRuntimeLocalAnonymousMethod(RuntimeMethodIds.local.applyProfile), false);
});

test('buildLocalProfileExtensions normalizes entry overrides and preserves unrelated extensions', () => {
  const extensions = buildLocalProfileExtensions(
    {
      entryOverrides: [
        { entryId: '  image-vae  ', localAssetId: ' asset-vae ' },
        { entryId: 'text-encoder', localAssetId: 'asset-llm' },
        { entryId: '', localAssetId: 'ignored-empty-entry' },
        { entryId: 'clip', localAssetId: '' },
      ],
      profileOverrides: {
        step: 8,
        cfg_scale: 1.5,
      },
    },
    {
      preserved: true,
    },
  );

  assert.deepEqual(extensions, {
    preserved: true,
    entry_overrides: [
      { entry_id: 'image-vae', local_asset_id: 'asset-vae' },
      { entry_id: 'text-encoder', local_asset_id: 'asset-llm' },
    ],
    profile_overrides: {
      step: 8,
      cfg_scale: 1.5,
    },
  });
});

test('resolveLocalRuntimeProfile forwards entryOverrides through SDK RuntimeLocalService', async () => {
  const calls: CapturedRuntimeCall[] = [];
  const restore = installRuntimeLocalBridge(calls);
  let unbindLocalRuntimeProvider: (() => void) | null = null;
  try {
    unbindLocalRuntimeProvider = await createRuntimeLocalPlatformClient();
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
    unbindLocalRuntimeProvider?.();
    restore();
  }
});
