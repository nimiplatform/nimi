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
  OpenLocalAppConversationResponse,
  ResolveDesktopAgentReferenceRequest,
  ResolveDesktopAgentReferenceResponse,
  ResolveLocalAppAvatarHostTargetRequest,
  ResolveLocalAppAvatarHostTargetResponse,
  TranscribeLocalAppConversationVoiceRequest,
  TranscribeLocalAppConversationVoiceResponse,
  UploadLocalAppConversationAttachmentRequest,
  UploadLocalAppConversationAttachmentResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import {
  ExecuteLocalAppScenarioRequest,
  ExecuteLocalAppScenarioResponse,
  GetLocalAppScenarioJobRequest,
  GetLocalAppScenarioJobResponse,
  SubmitLocalAppScenarioJobRequest,
  SubmitLocalAppScenarioJobResponse,
  AiVideoPixelFormat,
  OpenVideoSessionResponse,
  CloseVideoSessionResponse,
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
  it('keeps the Desktop named reference resolver on the same pending-call and rebind barrier', async () => {
    let finish!: (response: Uint8Array) => void;
    let resolverCalls = 0;
    let rebindCalls = 0;
    const reference = { agentHandle: `agent_ref_${'a'.repeat(43)}`, agentBinding: `agent_binding_${'b'.repeat(43)}`, activityAgentRef: 'agr_selected', displayName: 'Selected' };
    const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
      if (input.methodId.endsWith('/ResolveDesktopAgentReference')) {
        resolverCalls++;
        expect(ResolveDesktopAgentReferenceRequest.fromBinary(input.requestBytes)).toEqual({ localAgentRef: 'selected' });
        if (resolverCalls === 1) return new Promise<Uint8Array>(resolve => { finish = resolve; });
        return ResolveDesktopAgentReferenceResponse.toBinary({ reference });
      }
      if (input.methodId.endsWith('/RenewLocalAppSession')) throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      expect(input.methodId.endsWith('/RebindLocalAppSession')).toBe(true);
      rebindCalls++;
      return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({ state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED, currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE }));
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({ profile: 'desktop', appId: 'nimi.desktop', control: { accountProductUnary: unary } as unknown as NimiElectronDesktopControlHost });
    const response = ResolveDesktopAgentReferenceResponse.toBinary({ reference });
    try {
      expect('resolveDesktopAgentReference' in owner.host).toBe(false);
      const scope = owner.createResourceScope();
      expect('resolveDesktopAgentReference' in scope.host).toBe(false);
      const oldRequest = expect(owner.resolveDesktopAgentReference({ localAgentRef: 'selected' })).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      await vi.waitFor(() => expect(resolverCalls).toBe(1));
      const failedRenewal = expect(owner.host.renewTechnicalSession()).rejects.toMatchObject({ reasonCode: 'revoked' });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await expect(owner.resolveDesktopAgentReference({ localAgentRef: 'selected' })).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      expect(resolverCalls).toBe(1);
      expect(rebindCalls).toBe(0);
      finish(response);
      await oldRequest;
      await failedRenewal;
      expect(resolverCalls).toBe(1);
      expect(rebindCalls).toBe(1);
      await expect(owner.resolveDesktopAgentReference({ localAgentRef: 'selected' })).resolves.toEqual({ reference });
      expect(resolverCalls).toBe(2);
      await scope.dispose();
    } finally {
      finish?.(response);
      await owner.dispose();
    }
  });

  it('rejects non-Desktop and malformed named resolver requests before native dispatch', async () => {
    const unary = vi.fn(async () => new Uint8Array());
    const avatar = createNimiElectronFormalAppLocalHostOwner({ profile: 'avatar', appId: 'nimi.avatar', control: { bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost });
    const desktop = createNimiElectronFormalAppLocalHostOwner({ profile: 'desktop', appId: 'nimi.desktop', control: { accountProductUnary: unary } as unknown as NimiElectronDesktopControlHost });
    try {
      await expect(avatar.resolveDesktopAgentReference({ localAgentRef: 'selected' })).rejects.toMatchObject({ reasonCode: 'local-app-access-denied' });
      await expect(desktop.resolveDesktopAgentReference({ localAgentRef: ' selected ' })).rejects.toMatchObject({ reasonCode: 'invalid-input' });
      await expect(desktop.resolveDesktopAgentReference({ localAgentRef: 'selected', appId: 'nimi.desktop' } as never)).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
      expect(unary).not.toHaveBeenCalled();
    } finally {
      await avatar.dispose();
      await desktop.dispose();
    }
  });

  it.each(['desktop', 'avatar'] as const)('preserves Runtime video generation errors on %s owned resources', async (profile) => {
    const runtime = control(profile);
    const invoke = profile === 'desktop' ? runtime.host.accountProductUnary : runtime.host.bundledAvatarUnary;
    const unary = async (input: { methodId: string; requestBytes: Uint8Array }) => {
      if (input.methodId.endsWith('/OpenVideoSession')) {
        return OpenVideoSessionResponse.toBinary(OpenVideoSessionResponse.create({
          videoSessionId: 'video-1', generation: '1', maximumInFlightSubmissions: 2,
          format: { width: 1280, height: 720, pixelFormat: AiVideoPixelFormat.RGB8 },
        }));
      }
      if (input.methodId.endsWith('/CloseVideoSession')) {
        return CloseVideoSessionResponse.toBinary(CloseVideoSessionResponse.create({ closed: true }));
      }
      if (input.methodId.startsWith('/nimi.runtime.v1.RuntimeAiVideoSessionService/')) {
        throw new NimiElectronDesktopControlHostError('AI_VIDEO_SESSION_GENERATION_INVALID', false);
      }
      return invoke(input);
    };
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile, appId: `nimi.${profile}`,
      control: { ...runtime.host, [profile === 'desktop' ? 'accountProductUnary' : 'bundledAvatarUnary']: unary },
    });
    const scope = owner.createResourceScope();
    try {
      await scope.host.videoSessionOpen({ referenceImageArtifactId: 'reference-1', width: 1280, height: 720, pixelFormat: 'rgb8' });
      await expect(scope.host.videoSessionRead({ videoSessionId: 'video-1', generation: '2' }))
        .rejects.toMatchObject({ reasonCode: 'AI_VIDEO_SESSION_GENERATION_INVALID' });
      expect(() => scope.host.videoSessionRead({ videoSessionId: 'not-owned', generation: '1' }))
        .toThrow('not-found');
    } finally {
      await scope.dispose();
      await owner.dispose();
    }
  });

  it.each([false, true])('cancels only the owning sender transcription (dispose: %s)', async (dispose) => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const signals: AbortSignal[] = [];
    const unary = vi.fn(async (input: { signal?: AbortSignal }) => {
      expect(input.signal).toBeDefined();
      const signal = input.signal!;
      signals.push(signal);
      markStarted();
      return new Promise<Uint8Array>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('transcription aborted')), { once: true });
      });
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'desktop', appId: 'nimi.desktop',
      control: { accountProductUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });
    const scope = owner.createResourceScope();
    try {
      const pending = scope.host.conversationVoiceTranscribe({
        agentHandle: `agent_ref_${'A'.repeat(43)}`, conversationAnchorId: 'anchor-1',
        requestId: 'recording-1', mimeType: 'audio/webm', audioBytes: [1, 2, 3],
      });
      const rejected = expect(pending).rejects.toThrow();
      await started;
      await expect(owner.host.conversationVoiceTranscribe({ action: 'cancel', requestId: 'recording-1' }))
        .resolves.toEqual({ canceled: false });
      expect(signals[0]?.aborted).toBe(false);
      if (dispose) await scope.dispose();
      else await expect(scope.host.conversationVoiceTranscribe({ action: 'cancel', requestId: 'recording-1' }))
        .resolves.toEqual({ canceled: true });
      await rejected;
      expect(signals[0]?.aborted).toBe(true);
    } finally {
      await owner.dispose();
    }
  });

  it.each(['desktop', 'avatar'] as const)('converts %s Conversation binary payloads from IPC arrays to SDK bytes', async (profile) => {
    const handle = `agent_ref_${'A'.repeat(43)}`;
    const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
      if (input.methodId.endsWith('/TranscribeLocalAppConversationVoice')) {
        const request = TranscribeLocalAppConversationVoiceRequest.fromBinary(input.requestBytes);
        expect(request.audioBytes).toEqual(Uint8Array.from([1, 2, 3]));
        expect(request.mimeType).toBe('audio/webm;codecs=opus');
        return TranscribeLocalAppConversationVoiceResponse.toBinary({ text: 'spoken input' });
      }
      const request = UploadLocalAppConversationAttachmentRequest.fromBinary(input.requestBytes);
      expect(request.data).toEqual(Uint8Array.from([4, 5, 6]));
      expect(request.mimeType).toBe('image/png');
      return UploadLocalAppConversationAttachmentResponse.toBinary({ artifactId: 'image-1', expiresAt: '2026-09-10T00:00:00Z' });
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile, appId: profile === 'desktop' ? 'nimi.desktop' : 'nimi.avatar',
      control: { accountProductUnary: unary, bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });
    try {
      await expect(owner.host.conversationVoiceTranscribe({
        agentHandle: handle, conversationAnchorId: 'anchor-1', requestId: 'recording-1',
        mimeType: 'audio/webm;codecs=opus', audioBytes: [1, 2, 3],
      })).resolves.toEqual({ text: 'spoken input' });
      await expect(owner.host.conversationAttachmentUpload({
        agentHandle: handle, conversationAnchorId: 'anchor-1', mimeType: 'image/png', bytes: [4, 5, 6],
      })).resolves.toMatchObject({ artifactId: 'image-1' });
      expect(unary).toHaveBeenCalledTimes(2);
    } finally {
      await owner.dispose();
    }
  });

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
  ] as const)('preserves music action identity and read-only lookup through the %s formal codec', async (profile, appId) => {
    const methods: string[] = [];
    const job = { jobId: 'music-job', scenarioType: ScenarioType.MUSIC_GENERATE, status: ScenarioJobStatus.SUBMITTED, traceId: 'trace-music' };
    const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
      methods.push(input.methodId);
      if (input.methodId.endsWith('/SubmitLocalAppScenarioJob')) {
        const request = SubmitLocalAppScenarioJobRequest.fromBinary(input.requestBytes);
        expect(request.clientSubmissionId).toBe('music-action');
        expect(request.spec.oneofKind).toBe('musicGenerate');
        return SubmitLocalAppScenarioJobResponse.toBinary(SubmitLocalAppScenarioJobResponse.create({ job }));
      }
      expect(input.methodId).toBe('/nimi.runtime.v1.RuntimeAiService/GetLocalAppScenarioJob');
      expect(GetLocalAppScenarioJobRequest.fromBinary(input.requestBytes)).toEqual({ jobId: '', clientSubmissionId: 'music-action' });
      return GetLocalAppScenarioJobResponse.toBinary(GetLocalAppScenarioJobResponse.create({ job }));
    });
    const control = { accountProductUnary: unary, bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost;
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control });
    await host.scenarioJobSubmit({ spec: { type: 'music-generate', prompt: 'warm ballad', lyrics: 'sing this song' }, clientSubmissionId: 'music-action' });
    await expect(host.scenarioJobGet({ clientSubmissionId: 'music-action' })).resolves.toMatchObject({ job: { jobId: 'music-job' } });
    await expect(host.scenarioJobGet({ jobId: 'music-job', clientSubmissionId: 'music-action' })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    expect(methods).toHaveLength(2);
    unary.mockRejectedValueOnce(new NimiElectronDesktopControlHostError('AI_MEDIA_IDEMPOTENCY_CONFLICT', false));
    await expect(host.scenarioJobSubmit({ spec: { type: 'music-generate', prompt: 'changed', lyrics: 'different song' }, clientSubmissionId: 'music-action' }))
      .rejects.toMatchObject({ reasonCode: 'ai-media-idempotency-conflict', retryable: false });
    expect(unary).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('carries one text decision with caller controls through the %s formal codec', async (profile, appId) => {
    const spec = {
      type: 'text-decide',
      state: { json: '{"z":1,"a":[true,null]}' },
      questions: [
        {
          id: 'mood',
          instructions: { text: 'Pick the mood.' },
          kind: 'choice',
          candidates: [{ id: 'calm' }, { id: 'tense', description: { json: '["b","a"]' } }],
        },
        { id: 'act', instructions: { json: '{"b":2,"a":1}' }, kind: 'boolean', trueCriterion: { text: 'Act now.' } },
      ],
    };
    const transports: Array<{ timeoutMs?: number; requestTimeoutMs: number; signal?: AbortSignal }> = [];
    let respond = true;
    const unary = vi.fn(async (input: {
      methodId: string;
      requestBytes: Uint8Array;
      timeoutMs?: number;
      signal?: AbortSignal;
    }) => {
      expect(input.methodId).toBe('/nimi.runtime.v1.RuntimeAiService/ExecuteLocalAppScenario');
      const request = ExecuteLocalAppScenarioRequest.fromBinary(input.requestBytes);
      transports.push({ timeoutMs: input.timeoutMs, requestTimeoutMs: request.timeoutMs, signal: input.signal });
      expect(request.spec).toEqual({
        oneofKind: 'textDecide',
        textDecide: {
          state: { value: { oneofKind: 'json', json: '{"z":1,"a":[true,null]}' } },
          questions: [
            {
              id: 'mood',
              instructions: { value: { oneofKind: 'text', text: 'Pick the mood.' } },
              kind: { oneofKind: 'choice', choice: { candidates: [
                { id: 'calm' },
                { id: 'tense', description: { value: { oneofKind: 'json', json: '["b","a"]' } } },
              ] } },
            },
            {
              id: 'act',
              instructions: { value: { oneofKind: 'json', json: '{"b":2,"a":1}' } },
              kind: { oneofKind: 'boolean', boolean: { trueCriterion: { value: { oneofKind: 'text', text: 'Act now.' } } } },
            },
          ],
        },
      });
      if (!respond) {
        return new Promise<Uint8Array>(() => undefined);
      }
      return ExecuteLocalAppScenarioResponse.toBinary(ExecuteLocalAppScenarioResponse.create({
        output: { oneofKind: 'textDecide', textDecide: { answers: [
          { questionId: 'mood', result: { oneofKind: 'choice', choice: {
            selectedCandidateId: 'tense',
            probabilities: [{ candidateId: 'calm', probability: 0.25 }, { candidateId: 'tense', probability: 0.75 }],
          } } },
          { questionId: 'act', result: { oneofKind: 'boolean', boolean: { trueProbability: 0.6 } } },
        ] } },
        traceId: 'trace-decide',
      }));
    });
    const control = { accountProductUnary: unary, bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost;
    const host = createNimiElectronFormalAppLocalHost({ profile, appId, control });
    const caller = new AbortController();

    await expect(host.scenarioExecute({ spec, timeoutMs: 5_000 }, { signal: caller.signal })).resolves.toEqual({
      output: {
        type: 'text-decide',
        answers: [
          {
            questionId: 'mood',
            kind: 'choice',
            selectedCandidateId: 'tense',
            probabilities: [{ candidateId: 'calm', probability: 0.25 }, { candidateId: 'tense', probability: 0.75 }],
          },
          { questionId: 'act', kind: 'boolean', trueProbability: 0.6 },
        ],
      },
      traceId: 'trace-decide',
    });
    expect(transports[0]).toMatchObject({ requestTimeoutMs: 5_000, timeoutMs: 7_000 });
    expect(transports[0]?.signal).toBeInstanceOf(AbortSignal);

    unary.mockRejectedValueOnce(new NimiElectronDesktopControlHostError('AI_INPUT_LIMIT_EXCEEDED', false));
    await expect(host.scenarioExecute({ spec })).rejects.toMatchObject({
      reasonCode: 'ai-input-limit-exceeded',
      retryable: false,
    });

    respond = false;
    const aborted = expect(host.scenarioExecute({ spec }, { signal: caller.signal }))
      .rejects.toMatchObject({ reasonCode: 'canceled', retryable: false });
    await vi.waitFor(() => expect(transports).toHaveLength(2));
    expect(transports[1]?.signal?.aborted).toBe(false);
    caller.abort();
    await aborted;
    expect(transports[1]?.signal?.aborted).toBe(true);

    const timedOut = expect(host.scenarioExecute({ spec, timeoutMs: 20 }))
      .rejects.toMatchObject({ reasonCode: 'timeout', retryable: true });
    await vi.waitFor(() => expect(transports).toHaveLength(3));
    await timedOut;
    expect(transports[2]).toMatchObject({ requestTimeoutMs: 20, timeoutMs: 2_020 });
    // Runtime owns the request deadline; settling the caller must not turn it
    // into the explicit cancellation exercised above.
    expect(transports[2]?.signal?.aborted).toBe(false);
    await expect(host.scenarioExecute({ spec, extra: true })).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    expect(unary).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('preserves a typed image artifact seed through the %s formal codec', async (profile, appId) => {
    const methodId = '/nimi.runtime.v1.RuntimeAiService/GetLocalAppScenarioJob';
    const jobId = 'job-seeded-image';
    const unary = vi.fn(async (input: { methodId: string; requestBytes: Uint8Array }) => {
      expect(input.methodId).toBe(methodId);
      expect(GetLocalAppScenarioJobRequest.fromBinary(input.requestBytes)).toEqual({ jobId, clientSubmissionId: '' });
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
    ['desktop', 'nimi.desktop'],
    ['avatar', 'nimi.avatar'],
  ] as const)('maintains an active %s session without closing valid resources', async (profile, appId) => {
    vi.useFakeTimers();
    const runtime = control(profile);
    const owner = createNimiElectronFormalAppLocalHostOwner({ profile, appId, control: runtime.host });
    try {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
      expect(runtime.calls).toEqual([]);
      await owner.host.sessionStatus();
      const write = await owner.host.assetWriteOpen({
        relativePath: 'pending/session-renewal.bin', mediaType: 'application/octet-stream', overwrite: false,
      });

      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
      expect(runtime.calls.filter((method) => method.endsWith('/RenewLocalAppSession'))).toHaveLength(1);
      await expect(owner.host.assetWriteChunk({ streamId: write.streamId, bodyChunk: Uint8Array.from([1]) }))
        .resolves.toBeDefined();

      await owner.host.renewTechnicalSession();
      await expect(owner.host.assetWriteChunk({ streamId: write.streamId, bodyChunk: Uint8Array.from([2]) }))
        .resolves.toBeDefined();
      await owner.dispose();
      await expect(owner.host.assetWriteChunk({ streamId: write.streamId, bodyChunk: Uint8Array.from([3]) }))
        .rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
      expect(runtime.calls.filter((method) => method.endsWith('/RenewLocalAppSession'))).toHaveLength(2);
    } finally {
      await owner.dispose();
      vi.useRealTimers();
    }
  });

  it('fences the bundled Avatar formal session without replaying a business read', async () => {
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
      if (input.methodId.endsWith('/RebindLocalAppSession')) {
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

    await expect(host.agentReferenceList()).rejects.toMatchObject({ reasonCode: 'revoked' });
    expect(calls).toEqual([
      '/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentReferences',
      '/nimi.runtime.v1.RuntimeAuthService/RebindLocalAppSession',
    ]);
    expect(referenceCalls).toBe(1);
    await expect(host.agentReferenceList()).resolves.toEqual([]);
    expect(referenceCalls).toBe(2);
  });

  it.each([
    ['desktop', 'read'], ['desktop', 'mutation'], ['avatar', 'read'], ['avatar', 'mutation'],
  ] as const)('drains the old %s %s before rebind can change its admission scope', async (profile, kind) => {
    let finish!: () => void;
    let scope = 'A';
    const admissionScopes: string[] = [];
    const calls: string[] = [];
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const unary = vi.fn(async (input: { methodId: string }) => {
      calls.push(input.methodId);
      if (input.methodId.endsWith('/RenewLocalAppSession')) {
        throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      }
      if (input.methodId.endsWith('/RebindLocalAppSession')) {
        scope = 'B';
        return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
          state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED,
          currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
        }));
      }
      // Model a native request accepted into a queue but not yet admitted by
      // Runtime. Its read or side effect occurs only after that queue releases.
      await waiting;
      admissionScopes.push(scope);
      return input.methodId.endsWith('/OpenLocalAppConversation')
        ? OpenLocalAppConversationResponse.toBinary({ conversationAnchorId: 'old-anchor' })
        : new Uint8Array();
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile, appId: `nimi.${profile}`,
      control: { accountProductUnary: unary, bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });
    const host = owner.host;
    try {
      const pending = kind === 'mutation'
        ? host.conversationOpen({ agentHandle: `agent_ref_${'a'.repeat(43)}` })
        : host.agentReferenceList();
      const rejected = expect(pending).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      const failedRenewal = expect(host.renewTechnicalSession()).rejects.toMatchObject({ reasonCode: 'revoked' });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await expect(host.agentReferenceList()).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      expect(calls.filter(method => method.endsWith('/RebindLocalAppSession'))).toHaveLength(0);
      expect(admissionScopes).toEqual([]);
      expect(scope).toBe('A');
      finish();
      await rejected;
      await failedRenewal;
      expect(admissionScopes).toEqual(['A']);
      expect(scope).toBe('B');
      expect(calls.filter(method => method.endsWith('/RebindLocalAppSession'))).toHaveLength(1);
      await expect(host.agentReferenceList()).resolves.toEqual([]);
      expect(admissionScopes).toEqual(['A', 'B']);
    } finally {
      finish();
      await owner.dispose();
    }
  });

  it.each(['desktop', 'avatar'] as const)('waits for the %s native unary after its SDK caller has already canceled', async (profile) => {
    let finish!: () => void;
    let scope = 'A';
    const admissionScopes: string[] = [];
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const unary = vi.fn(async (input: { methodId: string }) => {
      if (input.methodId.endsWith('/ExecuteLocalAppScenario')) {
        await waiting;
        admissionScopes.push(scope);
        return ExecuteLocalAppScenarioResponse.toBinary(ExecuteLocalAppScenarioResponse.create({}));
      }
      if (input.methodId.endsWith('/RenewLocalAppSession')) {
        throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      }
      if (input.methodId.endsWith('/RebindLocalAppSession')) {
        scope = 'B';
        return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
          state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED,
          currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
        }));
      }
      throw new Error(`Unexpected method ${input.methodId}`);
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile, appId: `nimi.${profile}`,
      control: { accountProductUnary: unary, bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });
    try {
      const caller = new AbortController();
      const canceled = expect(owner.host.scenarioExecute({ spec: {
        type: 'text-decide', state: { json: '{}' },
        questions: [{ id: 'act', instructions: { text: 'Act?' }, kind: 'boolean', trueCriterion: { text: 'Act now.' } }],
      } }, { signal: caller.signal })).rejects.toMatchObject({ reasonCode: 'canceled' });
      await vi.waitFor(() => expect(unary).toHaveBeenCalledTimes(1));
      caller.abort();
      await canceled;
      const failedRenewal = expect(owner.host.renewTechnicalSession()).rejects.toMatchObject({ reasonCode: 'revoked' });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      expect(scope).toBe('A');
      expect(unary).toHaveBeenCalledTimes(2);
      finish();
      await failedRenewal;
      expect(admissionScopes).toEqual(['A']);
      expect(scope).toBe('B');
    } finally {
      finish();
      await owner.dispose();
    }
  });

  it.each(['desktop', 'avatar'] as const)('does not drain an active %s business call for normal renewal', async (profile) => {
    let finish!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>(resolve => { finish = resolve; });
    const unary = vi.fn(async (input: { methodId: string }) => {
      if (input.methodId.endsWith('/OpenLocalAppConversation')) return pending;
      if (input.methodId.endsWith('/RenewLocalAppSession')) return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
        state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED,
        currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
      }));
      throw new Error(`Unexpected method ${input.methodId}`);
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile, appId: `nimi.${profile}`,
      control: { accountProductUnary: unary, bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });
    try {
      const opening = owner.host.conversationOpen({ agentHandle: `agent_ref_${'a'.repeat(43)}` });
      await expect(owner.host.renewTechnicalSession()).resolves.toMatchObject({ state: 'ready' });
      finish(OpenLocalAppConversationResponse.toBinary({ conversationAnchorId: 'same-scope' }));
      await expect(opening).resolves.toMatchObject({ conversationAnchorId: 'same-scope' });
      expect(unary).toHaveBeenCalledTimes(2);
    } finally {
      finish(OpenLocalAppConversationResponse.toBinary({ conversationAnchorId: 'same-scope' }));
      await owner.dispose();
    }
  });

  it('cancels a pending formal pull before draining and does not require native onEnd', async () => {
    const cancelStream = vi.fn();
    const startStream = vi.fn();
    const unary = vi.fn(async (input: { methodId: string }) => {
      if (input.methodId.endsWith('/RenewLocalAppSession')) {
        throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      }
      expect(input.methodId.endsWith('/RebindLocalAppSession')).toBe(true);
      expect(cancelStream).toHaveBeenCalled();
      return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
        state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED,
        currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
      }));
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile: 'avatar', appId: 'nimi.avatar',
      control: {
        bundledAvatarUnary: unary,
        bundledAvatarServerStream: () => ({ start: startStream, cancel: cancelStream, closed: Promise.resolve() }),
      } as unknown as NimiElectronDesktopControlHost,
    });
    try {
      const opened = await owner.host.conversationSubscribe({
        agentHandle: `agent_ref_${'a'.repeat(43)}`, conversationAnchorId: 'old-anchor',
      });
      const pending = owner.host.conversationStreamNext({ streamId: opened.streamId });
      const rejected = expect(pending).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      await vi.waitFor(() => expect(startStream).toHaveBeenCalledOnce());
      await expect(owner.host.renewTechnicalSession()).rejects.toMatchObject({ reasonCode: 'revoked' });
      await rejected;
      expect(unary).toHaveBeenCalledTimes(2);
    } finally {
      await owner.dispose();
    }
  });

  it.each([
    ['desktop', true], ['desktop', false], ['avatar', true], ['avatar', false],
  ] as const)('keeps %s stream Open before rebind until native Close confirms (%s)', async (profile, confirmed) => {
    let releaseOpen!: () => void;
    let confirmClose!: () => void;
    let rejectClose!: (error: Error) => void;
    let settleClosed!: () => void;
    let failClosed!: (error: Error) => void;
    const nativeOpen = new Promise<void>(resolve => { releaseOpen = resolve; });
    const nativeClose = new Promise<void>((resolve, reject) => { confirmClose = resolve; rejectClose = reject; });
    const closed = new Promise<void>((resolve, reject) => { settleClosed = resolve; failClosed = reject; });
    let scope = 'A';
    let opened = false;
    let canceled = false;
    let closeRequested = false;
    const admissionScopes: string[] = [];
    const closeNative = vi.fn(() => {
      if (closeRequested) return;
      closeRequested = true;
      void nativeClose.then(settleClosed, failClosed);
    });
    const startStream = vi.fn(() => {
      void nativeOpen.then(() => {
        // This models the native Open reaching Runtime only after leaving its
        // queue. A model stream must still be admitted in A, never in B.
        admissionScopes.push(scope);
        opened = true;
        if (canceled) closeNative();
      });
    });
    const cancelStream = vi.fn(() => {
      canceled = true;
      if (opened) closeNative();
    });
    const unary = vi.fn(async (input: { methodId: string }) => {
      if (input.methodId.endsWith('/RenewLocalAppSession')) {
        throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      }
      expect(input.methodId.endsWith('/RebindLocalAppSession')).toBe(true);
      scope = 'B';
      return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
        state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED,
        currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
      }));
    });
    const streamFactory = vi.fn((input: { methodId: string }) => {
      expect(input.methodId.endsWith('/StreamLocalAppTextTurn')).toBe(true);
      return { start: startStream, cancel: cancelStream, closed };
    });
    const owner = createNimiElectronFormalAppLocalHostOwner({
      profile, appId: `nimi.${profile}`,
      control: {
        accountProductUnary: unary, bundledAvatarUnary: unary,
        accountProductServerStream: streamFactory, bundledAvatarServerStream: streamFactory,
      } as unknown as NimiElectronDesktopControlHost,
    });
    try {
      const subscription = await owner.host.textTurnSubscribe({ messages: [{ role: 'user', text: 'queued model turn' }] });
      const next = owner.host.textTurnStreamNext({ streamId: subscription.streamId });
      const oldRejected = expect(next).rejects.toMatchObject({ reasonCode: 'session-invalid' });
      await vi.waitFor(() => expect(startStream).toHaveBeenCalledOnce());
      const failedRenewal = expect(owner.host.renewTechnicalSession()).rejects.toMatchObject({ reasonCode: 'revoked' });
      await vi.waitFor(() => expect(cancelStream).toHaveBeenCalled());
      await oldRejected;
      expect(scope).toBe('A');
      expect(unary).toHaveBeenCalledTimes(1);
      expect(admissionScopes).toEqual([]);
      releaseOpen();
      await vi.waitFor(() => expect(closeNative).toHaveBeenCalled());
      expect(scope).toBe('A');
      expect(unary).toHaveBeenCalledTimes(1);
      expect(admissionScopes).toEqual(['A']);
      if (confirmed) {
        confirmClose();
        await failedRenewal;
        expect(scope).toBe('B');
        expect(unary).toHaveBeenCalledTimes(2);
      } else {
        rejectClose(new Error('native cancellation confirmation unavailable'));
        await failedRenewal;
        await expect(owner.host.sessionStatus()).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
        await expect(owner.host.agentReferenceList()).rejects.toMatchObject({ reasonCode: 'session-invalid' });
        expect(scope).toBe('A');
        expect(unary).toHaveBeenCalledTimes(1);
      }
    } finally {
      releaseOpen();
      confirmClose();
      await owner.dispose();
    }
  });

  it('rejects business requests during formal rebind instead of queuing them into the new scope', async () => {
    let entered!: () => void; let finish!: () => void; let calls = 0;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const unary = vi.fn(async (input: { methodId: string }) => {
      if (input.methodId.endsWith('/RebindLocalAppSession')) {
        entered(); await waiting;
        return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({ state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED, currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE }));
      }
      if (input.methodId.endsWith('/ListLocalAppAgentReferences')) {
        if (++calls === 1) throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
        return new Uint8Array();
      }
      throw new Error(`Unexpected method ${input.methodId}`);
    });
    const host = createNimiElectronFormalAppLocalHost({ profile: 'avatar', appId: 'nimi.avatar', control: { bundledAvatarUnary: unary } as unknown as NimiElectronDesktopControlHost });
    const pending = host.agentReferenceList();
    const rejected = expect(pending).rejects.toMatchObject({ reasonCode: 'revoked' });
    await started;
    await expect(host.agentReferenceList()).rejects.toMatchObject({ reasonCode: 'session-invalid' });
    await expect(host.conversationOpen({ agentHandle: `agent_ref_${'A'.repeat(43)}` })).rejects.toMatchObject({ reasonCode: 'session-invalid' });
    expect(calls).toBe(1);
    finish(); await rejected;
    await expect(host.agentReferenceList()).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it('renews after mutation admission failure without blindly replaying the mutation', async () => {
    const calls: string[] = [];
    const unary = vi.fn(async (input: { methodId: string }) => {
      calls.push(input.methodId);
      if (input.methodId.endsWith('/OpenLocalAppConversation')) {
        throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      }
      if (input.methodId.endsWith('/RebindLocalAppSession')) {
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
      '/nimi.runtime.v1.RuntimeAuthService/RebindLocalAppSession',
    ]);
  });

  it('never replays an activity publication or read mark after the formal session rebinds', async () => {
    const calls: string[] = [];
    const unary = vi.fn(async (input: { methodId: string }) => {
      calls.push(input.methodId);
      if (input.methodId.endsWith('/PutAppActivity') || input.methodId.endsWith('/MarkAppActivityRead')) {
        throw new NimiElectronDesktopControlHostError('LOCAL_APP_SESSION_REVOKED', false);
      }
      if (input.methodId.endsWith('/RebindLocalAppSession')) {
        return OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
          state: LocalAppSessionState.READY,
          reasonCode: ReasonCode.ACTION_EXECUTED,
          currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
        }));
      }
      throw new Error(`unexpected formal App method: ${input.methodId}`);
    });
    const host = createNimiElectronFormalAppLocalHost({
      profile: 'desktop', appId: 'nimi.desktop',
      control: { accountProductUnary: unary } as unknown as NimiElectronDesktopControlHost,
    });

    await expect(host.activityPut({
      key: 'draft:1', revision: 1, kind: 'todo', todoState: 'open', attention: true, title: 'Review',
      summary: null, objectRef: 'draft:1', type: 'com.example.studio.review-requested.v1',
      dataJson: null, occurredAt: '2026-09-20T09:00:00.000Z', agentHandle: null,
    })).rejects.toMatchObject({ reasonCode: 'revoked' });
    await expect(host.activityMarkRead({ activityId: `act_${'0'.repeat(26)}`, displayedRevision: 1 }))
      .rejects.toMatchObject({ reasonCode: 'revoked' });
    expect(calls).toEqual([
      '/nimi.runtime.v1.RuntimeAppActivityService/PutAppActivity',
      '/nimi.runtime.v1.RuntimeAuthService/RebindLocalAppSession',
      '/nimi.runtime.v1.RuntimeAppActivityService/MarkAppActivityRead',
      '/nimi.runtime.v1.RuntimeAuthService/RebindLocalAppSession',
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
          closed: Promise.resolve(),
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
