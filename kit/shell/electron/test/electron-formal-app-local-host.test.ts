import { describe, expect, it, vi } from 'vitest';
import {
  LocalAppSessionState,
  ReasonCode,
  ScenarioJobStatus,
  ScenarioType,
} from '@nimiplatform/sdk/runtime/generated';
import { OpenLocalAppSessionResponse } from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/auth.js';
import {
  GetAgentPresentationAssetRequest,
  GetAgentPresentationAssetResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import {
  GetLocalAppScenarioJobRequest,
  GetLocalAppScenarioJobResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/ai.js';
import {
  WriteLocalAppAssetRequest,
  WriteLocalAppAssetResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/app.js';
import type { NimiElectronDesktopControlHost } from '../src/main/desktop-control-host.js';
import { createNimiElectronFormalAppLocalHost } from '../src/main/formal-app-local-host.js';

function control(profile: 'desktop' | 'avatar') {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
    calls.push(input.methodId);
    bodies.push(Array.from(input.requestBytes));
    if (input.methodId.endsWith('/OpenLocalAppSession')
      || input.methodId.endsWith('/RenewLocalAppSession')) {
      return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
        state: LocalAppSessionState.READY,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
      }));
    }
    if (input.methodId.endsWith('/ListLocalAppAgentReferences')) {
      return new Uint8Array();
    }
    if (input.methodId.endsWith('/ListRealmChats')) {
      return new Uint8Array();
    }
    throw new Error(`unexpected formal App method: ${input.methodId}`);
  });
  const host = {
    accountProductUnary: profile === 'desktop' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
    bundledAvatarUnary: profile === 'avatar' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
  } as unknown as NimiElectronDesktopControlHost;
  return { bodies, calls, host };
}

describe('Electron formal App local host', () => {
  it.each([
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('binds %s standard commands to its protected formal profile', async (profile, appId) => {
    const runtime = control(profile);
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control: runtime.host });

    const status = await host.sessionStatus();
    expect(status).toEqual({
      state: 'ready',
      reasonCode: 'action-executed',
      retryable: false,
      currentUser: {
        state: 'unavailable',
        value: null,
        reasonCode: 'current-user-display-unavailable',
        retryable: true,
      },
    });
    await expect(host.realmChatList({})).resolves.toEqual({ items: [], nextCursor: null });
    expect(runtime.calls).toEqual([
      '/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession',
      '/nimi.runtime.v1.RuntimeRealmRealtimeService/ListRealmChats',
    ]);
    expect(runtime.bodies).toHaveLength(2);
  });

  it.each([
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('reads committed presentation assets through the same %s formal operation', async (profile, appId) => {
    const methodId = '/nimi.runtime.v1.RuntimeAgentService/GetAgentPresentationAsset';
    const handle = `agent_ref_${'A'.repeat(43)}`;
    const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
      expect(input.methodId).toBe(methodId);
      expect(GetAgentPresentationAssetRequest.fromBinary(input.requestBytes)).toEqual({
        agentHandle: handle,
        assetRef: 'vrm_0123456789ab',
      });
      return GetAgentPresentationAssetResponse.toBinary(GetAgentPresentationAssetResponse.create({
        assetRef: 'vrm_0123456789ab', role: 1, backendKind: 1,
        fileName: 'avatar.vrm', mediaType: 'model/gltf-binary',
        content: Uint8Array.from([1, 2, 3]), sha256: 'a'.repeat(64),
      }));
    });
    const controlHost = {
      accountProductUnary: profile === 'desktop' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
      bundledAvatarUnary: profile === 'avatar' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
    } as unknown as NimiElectronDesktopControlHost;
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control: controlHost });

    await expect(host.agentPresentationReadAsset({
      agentHandle: handle,
      assetRef: 'vrm_0123456789ab',
    })).resolves.toMatchObject({
      assetRef: 'vrm_0123456789ab', role: 'avatar', backendKind: 'vrm',
    });
    expect(unary).toHaveBeenCalledOnce();
  });

  it.each([
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('preserves a typed image artifact seed through the %s formal codec', async (profile, appId) => {
    const methodId = '/nimi.runtime.v1.RuntimeAiService/GetLocalAppScenarioJob';
    const jobId = 'job-seeded-image';
    const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
      expect(input.methodId).toBe(methodId);
      expect(GetLocalAppScenarioJobRequest.fromBinary(input.requestBytes)).toEqual({ jobId });
      return GetLocalAppScenarioJobResponse.toBinary(GetLocalAppScenarioJobResponse.create({
        job: {
          jobId,
          scenarioType: ScenarioType.IMAGE_GENERATE,
          status: ScenarioJobStatus.COMPLETED,
          progressPercent: 100,
          progressCurrentStep: 1,
          progressTotalSteps: 1,
          reasonCode: ReasonCode.ACTION_EXECUTED,
          artifacts: [{
            artifactId: 'artifact-seeded-image', mimeType: 'image/png',
            sizeBytes: '4', width: 1, height: 1, seed: 44,
          }],
          traceId: 'trace-seeded-image',
        },
      }));
    });
    const controlHost = {
      accountProductUnary: profile === 'desktop' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
      bundledAvatarUnary: profile === 'avatar' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
    } as unknown as NimiElectronDesktopControlHost;
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control: controlHost });

    await expect(host.scenarioJobGet({ jobId })).resolves.toMatchObject({
      job: { artifacts: [{ artifactId: 'artifact-seeded-image', seed: 44 }] },
    });
  });

  it.each([
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('revalidates %s session status instead of caching stale account state', async (profile, appId) => {
    let openCalls = 0;
    const unary = vi.fn(async (input: { methodId: string }) => {
      if (!input.methodId.endsWith('/OpenLocalAppSession')) {
        throw new Error(`unexpected formal App method: ${input.methodId}`);
      }
      openCalls += 1;
      return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
        state: LocalAppSessionState.READY,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        currentUser: {
          handle: openCalls === 1 ? '@first' : '@second',
          displayName: openCalls === 1 ? 'First' : 'Second',
        },
        currentUserReasonCode: ReasonCode.ACTION_EXECUTED,
      }));
    });
    const controlHost = {
      accountProductUnary: profile === 'desktop' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
      bundledAvatarUnary: profile === 'avatar' ? unary : vi.fn(async () => { throw new Error('wrong profile'); }),
    } as unknown as NimiElectronDesktopControlHost;
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control: controlHost });

    await expect(host.sessionStatus()).resolves.toMatchObject({
      currentUser: { value: { handle: '@first' } },
    });
    await expect(host.sessionStatus()).resolves.toMatchObject({
      currentUser: { value: { handle: '@second' } },
    });
    expect(openCalls).toBe(2);
  });

  it.each([
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('renews %s technical session directly after bootstrap', async (profile, appId) => {
    const runtime = control(profile);
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control: runtime.host });

    await host.sessionStatus();
    await host.renewTechnicalSession();

    expect(runtime.calls).toEqual([
      '/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession',
      '/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession',
    ]);
  });

  it.each([
    ['desktop', 'nimi.desktop', 'accountProductClientStream'],
    ['avatar', 'nimi.avatar', 'bundledAvatarClientStream'],
  ] as const)('writes App assets through the %s formal client stream', async (profile, appId, methodName) => {
    const methodId = '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset';
    let decodedFrames: unknown[] = [];
    const clientStream = vi.fn(async (input: {
      methodId: string;
      requestFrames: readonly Uint8Array[];
    }) => {
      decodedFrames = input.requestFrames.map((frame) => WriteLocalAppAssetRequest.fromBinary(frame));
      return WriteLocalAppAssetResponse.toBinary(WriteLocalAppAssetResponse.create({
        asset: {
          relativePath: 'media/avatar.png', mediaType: 'image/png', sizeBytes: '3',
          sha256: `sha256:${'a'.repeat(64)}`,
          createdAt: { seconds: '0', nanos: 0 },
          updatedAt: { seconds: '0', nanos: 0 },
        },
        reasonCode: ReasonCode.ACTION_EXECUTED,
      }));
    });
    const controlHost = {
      ...control(profile).host,
      accountProductClientStream: methodName === 'accountProductClientStream'
        ? clientStream
        : vi.fn(async () => { throw new Error('wrong profile'); }),
      bundledAvatarClientStream: methodName === 'bundledAvatarClientStream'
        ? clientStream
        : vi.fn(async () => { throw new Error('wrong profile'); }),
    } as unknown as NimiElectronDesktopControlHost;
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control: controlHost });

    const opened = await host.assetWriteOpen({
      relativePath: 'media/avatar.png', mediaType: 'image/png', overwrite: true,
    });
    await expect(host.assetWriteChunk({
      streamId: opened.streamId,
      bodyChunk: Uint8Array.from([1, 2, 3]),
    })).resolves.toEqual({ accepted: true });
    await expect(host.assetWriteCommit({ streamId: opened.streamId })).resolves.toEqual({
      relativePath: 'media/avatar.png', mediaType: 'image/png', sizeBytes: 3,
      sha256: `sha256:${'a'.repeat(64)}`,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(decodedFrames).toEqual([
      {
        frame: {
          oneofKind: 'metadata',
          metadata: { relativePath: 'media/avatar.png', mediaType: 'image/png', overwrite: true },
        },
      },
      { frame: { oneofKind: 'bodyChunk', bodyChunk: Uint8Array.from([1, 2, 3]) } },
    ]);
    expect(clientStream).toHaveBeenCalledOnce();
  });
});
