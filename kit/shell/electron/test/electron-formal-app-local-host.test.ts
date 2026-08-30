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
  ResolveLocalAppAvatarHostTargetRequest,
  ResolveLocalAppAvatarHostTargetResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import {
  GetLocalAppScenarioJobRequest,
  GetLocalAppScenarioJobResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/ai.js';
import {
  WriteLocalAppAssetRequest,
  WriteLocalAppAssetResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/app.js';
import {
  OpenRealmRealtimeChannelResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/realm_realtime.js';
import {
  RealtimeAdapterKind,
  RealtimeBackpressureState,
  RealtimeControlStatus,
  RealtimeLifecycle,
  RealtimeTerminalReason,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/realtime_control.js';
import {
  NimiElectronDesktopControlHostError,
  type NimiElectronDesktopControlHost,
} from '../src/main/desktop-control-host.js';
import {
  createNimiElectronFormalAppLocalHost,
  createNimiElectronFormalAppLocalHostOwner,
} from '../src/main/formal-app-local-host.js';

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
    ['desktop', 'nimi.desktop', 'accountProductUnary'],
    ['avatar', 'nimi.avatar', 'bundledAvatarUnary'],
  ] as const)('resolves Avatar correlation through the %s formal Host profile', async (
    profile,
    appId,
    unaryMethod,
  ) => {
    const methodId = '/nimi.runtime.v1.RuntimeAgentService/ResolveLocalAppAvatarHostTarget';
    const handle = `agent_ref_${'A'.repeat(43)}`;
    const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
      expect(input.methodId).toBe(methodId);
      expect(ResolveLocalAppAvatarHostTargetRequest.fromBinary(input.requestBytes)).toEqual({
        agentHandle: handle,
        conversationAnchorId: 'anchor-1',
      });
      return ResolveLocalAppAvatarHostTargetResponse.toBinary(
        ResolveLocalAppAvatarHostTargetResponse.create({
          avatarHostTargetRef: `avatar_target_${'B'.repeat(43)}`,
        }),
      );
    });
    const host = createNimiElectronFormalAppLocalHost({
      profile,
      appId,
      control: { [unaryMethod]: unary } as unknown as NimiElectronDesktopControlHost,
    });

    await expect(host.avatarHostTargetResolve({
      agentHandle: handle,
      conversationAnchorId: 'anchor-1',
    })).resolves.toEqual({
      avatarHostTargetRef: `avatar_target_${'B'.repeat(43)}`,
    });
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

  it('renews the bundled Avatar formal session once and retries a read-only bootstrap operation', async () => {
    let referenceCalls = 0;
    const calls: string[] = [];
    const unary = vi.fn(async (input: { methodId: string }) => {
      calls.push(input.methodId);
      if (input.methodId.endsWith('/ListLocalAppAgentReferences')) {
        referenceCalls += 1;
        if (referenceCalls === 1) {
          throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
        }
        return new Uint8Array();
      }
      if (input.methodId.endsWith('/RenewLocalAppSession')) {
        return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
          state: LocalAppSessionState.READY,
          reasonCode: ReasonCode.ACTION_EXECUTED,
          currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
        }));
      }
      throw new Error(`unexpected formal App method: ${input.methodId}`);
    });
    const host = createNimiElectronFormalAppLocalHost({
      profile: 'avatar', appId: 'nimi.avatar',
      control: { bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });

    await expect(host.agentReferenceList()).resolves.toEqual([]);
    expect(calls).toEqual([
      '/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentReferences',
      '/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession',
      '/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentReferences',
    ]);
  });

  it('renews after mutation admission failure without blindly replaying the mutation', async () => {
    const calls: string[] = [];
    const unary = vi.fn(async (input: { methodId: string }) => {
      calls.push(input.methodId);
      if (input.methodId.endsWith('/OpenLocalAppConversation')) {
        throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      }
      if (input.methodId.endsWith('/RenewLocalAppSession')) {
        return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
          state: LocalAppSessionState.READY,
          reasonCode: ReasonCode.ACTION_EXECUTED,
          currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
        }));
      }
      throw new Error(`unexpected formal App method: ${input.methodId}`);
    });
    const host = createNimiElectronFormalAppLocalHost({
      profile: 'avatar', appId: 'nimi.avatar',
      control: { bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });

    await expect(host.conversationOpen({ agentHandle: `agent_ref_${'a'.repeat(43)}` }))
      .rejects.toMatchObject({ reasonCode: 'revoked' });
    expect(calls).toEqual([
      '/nimi.runtime.v1.RuntimeAgentService/OpenLocalAppConversation',
      '/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession',
    ]);
  });

  it('invalidates local resources idempotently before Host reuse or shutdown', async () => {
    const runtime = control('avatar');
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar', appId: 'nimi.avatar', control: runtime.host,
    });
    const opened = await owner.host.assetWriteOpen({
      relativePath: 'pending/avatar.bin', mediaType: 'application/octet-stream', overwrite: false,
    });
    await owner.host.assetWriteChunk({
      streamId: opened.streamId,
      bodyChunk: Uint8Array.from([1, 2, 3]),
    });
    await owner.invalidateResources();
    await expect(owner.host.assetWriteCommit({ streamId: opened.streamId }))
      .rejects.toMatchObject({ reasonCode: 'not-found' });
    await owner.dispose();
    await owner.dispose();
  });

  it('candidate scope failure disposes only candidate resources and preserves current sender resources', async () => {
    const runtime = control('avatar');
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar', appId: 'nimi.avatar', control: runtime.host,
    });
    const current = owner.createResourceScope();
    const candidate = owner.createResourceScope();
    const currentWrite = await current.host.assetWriteOpen({
      relativePath: 'current/avatar.bin', mediaType: 'application/octet-stream', overwrite: false,
    });
    const candidateWrite = await candidate.host.assetWriteOpen({
      relativePath: 'candidate/avatar.bin', mediaType: 'application/octet-stream', overwrite: false,
    });

    await candidate.dispose();

    await expect(current.host.assetWriteChunk({
      streamId: currentWrite.streamId,
      bodyChunk: Uint8Array.from([1]),
    })).resolves.toEqual({ accepted: true });
    await expect(candidate.host.assetWriteChunk({
      streamId: candidateWrite.streamId,
      bodyChunk: Uint8Array.from([2]),
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
    await current.dispose();
    await owner.dispose();
  });

  it('bounds both the first timed-out sender disposal and a repeated disposal of its original cleanup', async () => {
    const never = new Promise<Uint8Array>(() => {});
    const unary = vi.fn(async (input: { methodId: string }) => {
      if (input.methodId.endsWith('/OpenRealmRealtimeChannel')) {
        return OpenRealmRealtimeChannelResponse.toBinary(OpenRealmRealtimeChannelResponse.create({
          realtimeSessionId: 'realm-session-1',
          channelId: 'realm-channel-1',
          generation: '1',
          status: RealtimeControlStatus.create({
            realtimeSessionId: 'realm-session-1',
            channelId: 'realm-channel-1',
            subscriptionId: '',
            adapterKind: RealtimeAdapterKind.REALM,
            lifecycle: RealtimeLifecycle.READY,
            generation: '1',
            sequence: '0',
            correlationId: 'correlation-1',
            backpressure: RealtimeBackpressureState.NORMAL,
            bufferedItems: 0,
            bufferCapacity: 32,
            terminalReason: RealtimeTerminalReason.UNSPECIFIED,
            actionHint: '',
            occurredAt: { seconds: '1', nanos: 0 },
          }),
        }));
      }
      if (input.methodId.endsWith('/CloseRealmRealtimeChannel')) return never;
      throw new Error(`unexpected formal App method: ${input.methodId}`);
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar',
      appId: 'nimi.avatar',
      control: { bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });
    const candidate = owner.createResourceScope();
    await candidate.host.realmRealtimeOpen();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const first = candidate.dispose();
      await vi.advanceTimersByTimeAsync(2_001);
      await expect(first).resolves.toBeUndefined();

      const retry = candidate.dispose();
      await vi.advanceTimersByTimeAsync(2_001);
      await expect(retry).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      warning.mockRestore();
    }
  });

  it('sender disposal fences late pull and write opens before they can enter the disposed scope', async () => {
    const runtime = control('avatar');
    const cancelStream = vi.fn();
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar',
      appId: 'nimi.avatar',
      control: {
        ...runtime.host,
        bundledAvatarServerStream: vi.fn(() => ({
          start() {},
          cancel: cancelStream,
        })),
      } as unknown as NimiElectronDesktopControlHost,
    });
    const candidate = owner.createResourceScope();

    const lateWrite = candidate.host.assetWriteOpen({
      relativePath: 'candidate/late.bin', mediaType: 'application/octet-stream', overwrite: false,
    });
    const lateConversation = candidate.host.conversationSubscribe({
      agentHandle: `agent_ref_${'a'.repeat(43)}`,
      conversationAnchorId: 'anchor-late',
    });
    const disposal = candidate.dispose();

    await expect(lateWrite).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
    await expect(lateConversation).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
    await disposal;
    await expect(candidate.host.assetWriteCommit({ streamId: 'formal-app-asset-write-1' }))
      .rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
    await owner.dispose();
  });

  it('scope invalidation generation rejects a late write while allowing a fresh post-invalidation open', async () => {
    const runtime = control('avatar');
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar', appId: 'nimi.avatar', control: runtime.host,
    });
    const candidate = owner.createResourceScope();

    const lateWrite = candidate.host.assetWriteOpen({
      relativePath: 'candidate/late.bin', mediaType: 'application/octet-stream', overwrite: false,
    });
    const invalidation = candidate.invalidateResources();

    await expect(lateWrite).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
    await invalidation;
    await expect(candidate.host.assetWriteCommit({ streamId: 'formal-app-asset-write-1' }))
      .rejects.toMatchObject({ reasonCode: 'not-found' });
    await expect(candidate.host.assetWriteOpen({
      relativePath: 'candidate/fresh.bin', mediaType: 'application/octet-stream', overwrite: false,
    })).resolves.toMatchObject({ streamId: 'formal-app-asset-write-2' });
    await candidate.dispose();
    await owner.dispose();
  });

  it('promotion old-sender close preserves candidate resources and enforces scope ownership', async () => {
    const runtime = control('avatar');
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar', appId: 'nimi.avatar', control: runtime.host,
    });
    const current = owner.createResourceScope();
    const candidate = owner.createResourceScope();
    const currentWrite = await current.host.assetWriteOpen({
      relativePath: 'current/avatar.bin', mediaType: 'application/octet-stream', overwrite: false,
    });
    const candidateWrite = await candidate.host.assetWriteOpen({
      relativePath: 'candidate/avatar.bin', mediaType: 'application/octet-stream', overwrite: false,
    });
    await expect(current.host.assetWriteChunk({
      streamId: candidateWrite.streamId,
      bodyChunk: Uint8Array.from([1]),
    })).rejects.toMatchObject({ reasonCode: 'not-found' });

    await current.dispose();

    await expect(candidate.host.assetWriteChunk({
      streamId: candidateWrite.streamId,
      bodyChunk: Uint8Array.from([2]),
    })).resolves.toEqual({ accepted: true });
    await expect(candidate.host.assetWriteChunk({
      streamId: currentWrite.streamId,
      bodyChunk: Uint8Array.from([3]),
    })).rejects.toMatchObject({ reasonCode: 'not-found' });
    await candidate.dispose();
    await owner.dispose();
  });

  it('owner invalidation clears every sender scope while keeping scopes reusable for a fresh session', async () => {
    const runtime = control('avatar');
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar', appId: 'nimi.avatar', control: runtime.host,
    });
    const current = owner.createResourceScope();
    const candidate = owner.createResourceScope();
    const currentWrite = await current.host.assetWriteOpen({
      relativePath: 'current/avatar.bin', mediaType: 'application/octet-stream', overwrite: false,
    });
    const candidateWrite = await candidate.host.assetWriteOpen({
      relativePath: 'candidate/avatar.bin', mediaType: 'application/octet-stream', overwrite: false,
    });

    await owner.invalidateResources();

    await expect(current.host.assetWriteChunk({
      streamId: currentWrite.streamId,
      bodyChunk: Uint8Array.from([1]),
    })).rejects.toMatchObject({ reasonCode: 'not-found' });
    await expect(candidate.host.assetWriteChunk({
      streamId: candidateWrite.streamId,
      bodyChunk: Uint8Array.from([2]),
    })).rejects.toMatchObject({ reasonCode: 'not-found' });
    await expect(candidate.host.assetWriteOpen({
      relativePath: 'candidate/fresh.bin', mediaType: 'application/octet-stream', overwrite: false,
    })).resolves.toMatchObject({ streamId: expect.any(String) });
    await current.dispose();
    await candidate.dispose();
    await owner.dispose();
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
