import { describe, expect, it, vi } from 'vitest';

import {
  createNimiElectronLocalAppHostForBinding,
  primeNimiElectronLocalAppHost,
  resolveNimiElectronProtectedLocalBindingPackage,
  startNimiElectronLocalAppHostMaintenance,
} from '../src/main/local-app-host.js';

describe('Electron protected local-app host', () => {
  it('preserves voice conversion source facts and the reported tail delta on Get and events', async () => {
    const artifacts = [{ artifactId: 'vocal-1', mimeType: 'audio/wav', sizeBytes: 963400 }]
      .map(value => ({ ...value, bytes: [], sha256: 'a'.repeat(64), durationMs: 10034, width: 0, height: 0, sampleRateHz: 24000, channels: 1, frameCount: 240828 }));
    const voiceConversion = { vocalArtifactId: 'vocal-1', sourceArtifactId: 'source-1',
      sourceInfo: { sampleRateHz: 48000, channels: 2, frameCount: 480000, durationMs: 10000 },
      inputRange: { startFrame: 0, endFrame: 480000 },
      vocalInfo: { sampleRateHz: 24000, channels: 1, frameCount: 240828, durationMs: 10034 },
      lengthRelation: 'MODEL_FRAME_ROUNDING', durationDeltaMs: 34 };
    const job = scenarioJobProjection({ scenarioType: 'audio-voice-convert', status: 'completed', artifacts, voiceConversion,
      recoveryExpiresAt: { seconds: '1790086467', nanos: 0 } });
    const event = { eventType: 'completed', sequence: '3', traceId: 'trace-convert', timestamp: null, job };
    const candidate = { ...binding([]),
      localAppScenarioJobGet: async () => ({ status: 'ok' as const, value: { job, asset: null, voiceReference: null } }),
      localAppScenarioJobStreamNext: async () => ({ status: 'ok' as const, value: { completed: false, event } }),
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.scenarioJobGet({ jobId: job.jobId })).resolves.toEqual({ job, asset: null, voiceReference: null });
    await expect(host.scenarioJobStreamNext({ streamId: 'convert-stream' })).resolves.toEqual({ completed: false, event });
    candidate.localAppScenarioJobGet = async () => ({ status: 'ok', value: { job: { ...job, voiceConversion: { ...voiceConversion, durationDeltaMs: 0 } }, asset: null, voiceReference: null } });
    await expect(host.scenarioJobGet({ jobId: job.jobId })).rejects.toBeDefined();
  });
  it('preserves music transcription source facts and both output files on Get and events', async () => {
    const artifacts = [{ artifactId: 'score-1', mimeType: 'text/vnd.abc', sizeBytes: 512 },
      { artifactId: 'events-1', mimeType: 'application/vnd.nimi.music-timeline+json', sizeBytes: 1024 }]
      .map(value => ({ ...value, bytes: [], sha256: 'a'.repeat(64), durationMs: 0, width: 0, height: 0, sampleRateHz: 0, channels: 0 }));
    const musicTranscription = { sourceArtifactId: 'source-1', sourceInfo: { sampleRateHz: 48000, channels: 2, frameCount: 960000, durationMs: 20000 },
      inputRange: { startFrame: 48000, endFrame: 480000 }, origin: 'transcribed-estimate', completeness: 'unknown',
      scores: [{ artifactId: 'score-1', format: 'abc', part: 'lead-sheet' }], timelineArtifactId: 'events-1' };
    const job = scenarioJobProjection({ scenarioType: 'music-transcribe', status: 'completed', artifacts, musicTranscription,
      recoveryExpiresAt: { seconds: '1790086467', nanos: 0 } });
    const event = { eventType: 'completed', sequence: '3', traceId: 'trace-music', timestamp: null, job };
    const candidate = { ...binding([]),
      localAppScenarioJobGet: async () => ({ status: 'ok' as const, value: { job, asset: null, voiceReference: null } }),
      localAppScenarioJobStreamNext: async () => ({ status: 'ok' as const, value: { completed: false, event } }),
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.scenarioJobGet({ jobId: job.jobId })).resolves.toEqual({ job, asset: null, voiceReference: null });
    await expect(host.scenarioJobStreamNext({ streamId: 'music-stream' })).resolves.toEqual({ completed: false, event });
    candidate.localAppScenarioJobGet = async () => ({ status: 'ok', value: { job: { ...job, artifacts: artifacts.slice(0, 1) }, asset: null, voiceReference: null } });
    await expect(host.scenarioJobGet({ jobId: job.jobId })).rejects.toBeDefined();
  });
  it('preserves complete real-format music results through Get and terminal events', async () => {
    const artifact = { artifactId: '01M31XPDSR0XFQJVY8NSBQRVED', mimeType: 'audio/wav', bytes: [],
      sizeBytes: 7049274, sha256: '4e848edd82bf57a886b92f566020703b9252fb5e583c4751326394e4f120a8ed',
      durationMs: 19980, width: 0, height: 0, sampleRateHz: 44100, channels: 2, frameCount: 881152 };
    const musicGeneration = { mixArtifactId: artifact.artifactId, actualSeed: 42, termination: 'unknown',
      audioInfo: { sampleRateHz: 44100, channels: 2, frameCount: 881152, durationMs: 19980 } };
    const job = scenarioJobProjection({ scenarioType: 'music-generate', status: 'completed', artifacts: [artifact], musicGeneration,
      recoveryExpiresAt: { seconds: '1790086467', nanos: 838649200 } });
    const event = { eventType: 'completed', sequence: '3', traceId: 'trace-music', timestamp: null, job };
    const candidate = { ...binding([]),
      localAppScenarioJobGet: async () => ({ status: 'ok' as const, value: { job, asset: null, voiceReference: null } }),
      localAppScenarioJobStreamNext: async () => ({ status: 'ok' as const, value: { completed: false, event } }),
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.scenarioJobGet({ jobId: job.jobId })).resolves.toEqual({ job, asset: null, voiceReference: null });
    await expect(host.scenarioJobStreamNext({ streamId: 'music-stream' })).resolves.toEqual({ completed: false, event });
    const malformed = { ...job, musicGeneration: undefined };
    candidate.localAppScenarioJobGet = async () => ({ status: 'ok', value: { job: malformed, asset: null, voiceReference: null } });
    await expect(host.scenarioJobGet({ jobId: job.jobId })).rejects.toBeDefined();
  });
  it('preserves typed transcription through the native Host boundary', async () => {
    const transcription = { status: 'transcribed', text: 'hello', language: 'en', words: [{ text: 'hello', startSeconds: 0.2, endSeconds: 0.8 }] };
    const host = createNimiElectronLocalAppHostForBinding({ ...binding([]), localAppScenarioJobGet: async () => ({ status: 'ok', value: { job: scenarioJobProjection({ scenarioType: 'speech-transcribe', status: 'completed', transcriptionText: 'hello', transcription }), asset: null, voiceReference: null } }) });
    const result = await host.scenarioJobGet({ jobId: 'job-1' });
    expect((result.job as Record<string, unknown>).transcription).toEqual(transcription);
  });

  it('preserves the embedding space through the Host projection and rejects an absent identity', async () => {
    const candidate = binding([]);
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.scenarioExecute({ spec: { type: 'text-embed', inputs: ['document'] } })).resolves.toEqual({
      output: { type: 'text-embed', vectors: [[0.1, 0.2]], spaceId: 'space-test-1' }, traceId: 'trace-1',
    });
    candidate.localAppScenarioExecute = async () => ({ status: 'ok', value: {
      output: { type: 'text-embed', vectors: [[0.1, 0.2]] }, traceId: 'trace-1',
    } });
    await expect(host.scenarioExecute({ spec: { type: 'text-embed', inputs: ['document'] } })).rejects.toMatchObject({
      reasonCode: 'runtime-service-untrusted',
    });
  });
  it('preserves App-owned work on a successful routine renewal', async () => {
    let invalidated = 0;
    const host = createNimiElectronLocalAppHostForBinding(binding([]), () => { invalidated++; });
    await expect(host.renewTechnicalSession()).resolves.toEqual(statusProjection());
    expect(invalidated).toBe(0);
  });

  it('invalidates App-owned work before an unsuccessful technical rebind', async () => {
    let invalidated = false;
    const candidate = binding([]);
    candidate.localAppStorageReadJson = async () => ({ status: 'error', reasonCode: 'account-changed', retryable: false });
    candidate.localAppSessionRenew = async () => {
      expect(invalidated).toBe(true);
      return { status: 'error', reasonCode: 'runtime-service-unavailable', retryable: true };
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate, () => { invalidated = true; });
    await expect(host.storageReadJson({ relativePath: 'config.json' })).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
    expect(invalidated).toBe(true);
  });

  it.each(['ai-text-behavior-unsupported', 'ai-text-output-incomplete', 'ai-tool-call-invalid', 'ai-media-idempotency-conflict'])('preserves the typed AI failure %s', async (reasonCode) => {
    const candidate = binding([]);
    candidate.localAppScenarioExecute = async () => ({ status: 'error', reasonCode, retryable: false });
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.scenarioExecute({ spec: { type: 'text-generate', messages: [{ role: 'user', text: 'Hello' }] } })).rejects.toMatchObject({ reasonCode });
  });

  it('preserves world content across list/create/get/replace while rejecting frame authority', async () => {
    const world = { id: 'world-1', core: { systems: [{ systemId: 'trade', name: 'Trade', summary: 'Markets.', parameters: { token: 'coin', generation: 3 } }] } };
    let value: Record<string, unknown> = world;
    const host = createNimiElectronLocalAppHostForBinding({ ...binding([]),
      localAppRealmWorldCoreList: async () => ({ status: 'ok' as const, value: [value] }),
      localAppRealmWorldCoreCreate: async () => ({ status: 'ok' as const, value }),
      localAppRealmWorldCoreGet: async () => ({ status: 'ok' as const, value }),
      localAppRealmWorldCoreReplace: async () => ({ status: 'ok' as const, value }),
    });
    const body = { core: world.core, lorebookDeclaration: {}, origin: { kind: 'manual' } };
    const calls = [() => host.realmWorldCoreList(), () => host.realmWorldCoreGet({ worldId: 'world-1' }),
      () => host.realmWorldCoreCreate(body), () => host.realmWorldCoreReplace({ worldId: 'world-1', body: { ...body, baseContentHash: 'a'.repeat(64) } })];
    for (const call of calls) {
      const result = await call();
      expect(Array.isArray(result) ? result[0] : result).toEqual(world);
    }
    value = { ...world, accessToken: 'unexpected' };
    for (const call of calls) await expect(call()).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
  });

  it('bootstraps and rotates only the request-empty technical session', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ method: string; input?: unknown }> = [];
      const host = createNimiElectronLocalAppHostForBinding(binding(calls));
      await expect(primeNimiElectronLocalAppHost(host)).resolves.toBeUndefined();
      const maintenance = startNimiElectronLocalAppHostMaintenance(host, 1_000);
      await maintenance.ready;
      await vi.advanceTimersByTimeAsync(1_000);
      maintenance.close();
      expect(calls.map(({ method }) => method)).toEqual([
        'localAppSessionStatus',
        'localAppSessionStatus',
        'localAppSessionRenew',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['status', 'read'] as const)('resumes maintenance after explicit %s recovery without retrying a failed session in the background', async (recovery) => {
    vi.useFakeTimers();
    const candidate = binding([]);
    let available = false;
    let renewals = 0;
    candidate.localAppSessionRenew = async () => {
      renewals++;
      return available
        ? { status: 'ok', value: statusProjection() }
        : { status: 'error', reasonCode: 'runtime-service-unavailable', retryable: true };
    };
    let reads = 0;
    candidate.localAppStorageReadJson = async () => ++reads === 1
      ? { status: 'error', reasonCode: 'revoked', retryable: false }
      : { status: 'ok', value: { value: { version: 1 }, sizeBytes: 13 } };
    const onFailure = vi.fn();
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    const maintenance = startNimiElectronLocalAppHostMaintenance(host, 1_000, onFailure);
    try {
      await maintenance.ready;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onFailure).toHaveBeenCalledWith({ reasonCode: 'runtime-service-unavailable', retryable: true });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(renewals).toBe(1);

      available = true;
      if (recovery === 'status') await host.sessionStatus();
      else await host.storageReadJson({ relativePath: 'config.json' });
      const afterRecovery = renewals;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(renewals).toBe(afterRecovery + 1);
      expect(onFailure).toHaveBeenCalledTimes(1);

      maintenance.close();
      await host.sessionStatus();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(renewals).toBe(afterRecovery + 1);
    } finally {
      maintenance.close();
      vi.useRealTimers();
    }
  });

  it('exposes only configuration methods alongside the protected session surface', () => {
    const host = createNimiElectronLocalAppHostForBinding(binding([])) as unknown as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(host));
    expect(methods).not.toContain('permission');
    expect(methods.some((key) => /request|grant|revoke/iu.test(key))).toBe(false);
    expect(methods).toContain('artifactRead');
    expect(methods).toContain('artifactUpload');
    expect(methods).toEqual(expect.arrayContaining([
      'sharedAgentAIConfigGet',
      'sharedAgentAIConfigOverwrite',
      'sharedAgentAIConfigLocalOptions',
      'agentManagerSnapshot',
      'agentAutonomySnapshot',
      'agentUpdateAutonomy',
      'agentPresentationSnapshot',
      'agentCommitPresentation',
      'agentMemoryInspect',
      'agentMemoryCorrect',
      'agentMemoryForget',
      'agentMemorySwitch',
      'agentMemoryDelete',
    ]));
  });

  it('forwards exact WorldCore, app-private storage, and typed conversation operations', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));

    await expect(host.sessionStatus()).resolves.toEqual(statusProjection());
    await expect(host.realmWorldCoreList({ take: 20, visibility: 'private' }))
      .resolves.toEqual([{ id: 'world-1', visibility: 'private' }]);
    await expect(host.storageReadJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ value: { version: 1 }, sizeBytes: 13 });
    await expect(host.agentReferenceList()).resolves.toEqual([{
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      displayName: 'Agent One',
      avatarUrl: null,
    }]);
    await expect(host.avatarHostTargetResolve({
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      conversationAnchorId: 'anchor-1',
    })).resolves.toEqual({
      avatarHostTargetRef: 'avatar_target_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
    await expect(host.conversationOpen({ agentHandle: 'lash_one' }))
      .resolves.toEqual({ conversationAnchorId: 'anchor-1', activeTurnId: null });
    await expect(host.conversationAttachmentUpload({
      agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', mimeType: 'image/png',
      displayName: 'attachment.png', bytes: [1, 2, 3],
    })).resolves.toEqual({ artifactId: 'artifact-1', expiresAt: '2026-08-23T09:00:00Z' });
    await expect(host.conversationVoiceTranscribe({
      agentHandle: 'lash_one', conversationAnchorId: 'anchor-1', requestId: 'voice-request-1',
      mimeType: 'audio/webm', audioBytes: [1, 2, 3],
    })).resolves.toEqual({ text: 'transcribed intent' });
    await expect(host.conversationVoiceTranscribe({ action: 'cancel', requestId: 'voice-request-1' }))
      .resolves.toEqual({ canceled: true });
    await expect(host.conversationVoiceRender({
      agentHandle: 'lash_one', conversationAnchorId: 'anchor-1',
      messageId: 'message-1', requestId: 'voice-render-request-1',
    })).resolves.toEqual({
      voice: {
        voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-1', state: 'ready',
        artifactId: 'artifact-voice-1', reasonCode: null, message: null,
      },
    });

    expect(calls.map(({ method }) => method)).toEqual([
      'localAppSessionStatus',
      'localAppRealmWorldCoreList',
      'localAppStorageReadJson',
      'localAppAgentReferenceList',
      'localAppAvatarHostTargetResolve',
      'localAppConversationOpen',
      'localAppConversationAttachmentUpload',
      'localAppConversationVoiceTranscribe',
      'localAppConversationVoiceTranscribeCancel',
      'localAppConversationVoiceRender',
    ]);
  });

  it('forwards exact owner PersonaCharacter envelopes without duplicating the SDK projection', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));
    await expect(host.realmPersonaCharacterListOwned({ worldId: 'world-1', visibility: 'private', afterId: 'persona-0', take: 50 }))
      .resolves.toEqual([personaProjection()]);
    await expect(host.realmPersonaCharacterGetOwned({ personaCharacterId: 'persona-1' }))
      .resolves.toEqual(personaProjection());
    await expect(host.realmPersonaCharacterCreate({ worldId: 'world-1', visibility: 'private', origin: { kind: 'manual' }, lorebookDeclaration: personaLorebookDeclaration(), profile: personaProfileInput() }))
      .resolves.toEqual(personaProjection());
    await expect(host.realmPersonaCharacterReplace({ personaCharacterId: 'persona-1', body: { baseContentHash: 'a'.repeat(64), worldId: 'world-1', visibility: 'private', origin: { kind: 'manual' }, lorebookDeclaration: personaLorebookDeclaration(), profile: personaProfileInput() } }))
      .resolves.toEqual(personaProjection());
    await expect(host.realmPersonaCharacterDelete({ personaCharacterId: 'persona-1' }))
      .resolves.toEqual({ personaCharacterId: 'persona-1', deleted: true });
    expect(calls.map(({ method }) => method)).toEqual([
      'localAppRealmPersonaCharacterListOwned',
      'localAppRealmPersonaCharacterGetOwned',
      'localAppRealmPersonaCharacterCreate',
      'localAppRealmPersonaCharacterReplace',
      'localAppRealmPersonaCharacterDelete',
    ]);

    const opaque = binding([]);
    opaque.localAppRealmPersonaCharacterGetOwned = async () => ({
      status: 'ok', value: { ...personaProjection(), profile: { token: 'product-token', narrative: 'opaque.jwt.value' } },
    });
    await expect(createNimiElectronLocalAppHostForBinding(opaque).realmPersonaCharacterGetOwned({ personaCharacterId: 'persona-1' }))
      .resolves.toMatchObject({ profile: { token: 'product-token' } });
    await expect(host.realmPersonaCharacterCreate({
      worldId: 'world-1', visibility: 'private', origin: { kind: 'forge' },
      lorebookDeclaration: personaLorebookDeclaration(),
      profile: { token: 'product-token', authoring: { extensions: { future: { fields: { secret: 'story' } } } } },
    })).resolves.toEqual(personaProjection());
    expect(() => host.realmPersonaCharacterCreate({ worldId: 'world-1', visibility: 'system', origin: {}, lorebookDeclaration: {}, profile: {} }))
      .toThrow(expect.objectContaining({ reasonCode: 'runtime-service-untrusted' }));
  });

  it('forwards the exact Agent configuration payloads and restore projection', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));
    const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const autonomyUpdate = {
      agentHandle: handle, expectedAutonomyRevision: '1', intent: { enabled: true },
    };
    const presentationCommit = {
      agentHandle: handle,
      expectedPresentationRevision: '0',
      intent: {
        backendKind: 'vrm', avatarAssetRef: '', expressionProfileRef: '', idlePreset: '',
        interactionPolicyRef: '', defaultVoiceReference: '', avatarAutoplay: false,
        backgroundAssetRef: '',
      },
      importedAssets: [{
        role: 'avatar', fileName: 'avatar.vrm', mediaType: 'model/gltf-binary',
        content: [1, 2, 255], sha256: 'abc123',
      }],
    };

    await expect(host.sharedAgentAIConfigGet()).resolves.toMatchObject({ config: { capabilities: [] }, revision: '0' });
    await expect(host.sharedAgentAIConfigOverwrite({ expectedRevision: '0', capabilities: [] }))
      .resolves.toMatchObject({ outcome: 'committed', config: { capabilities: [] }, revision: '1' });
    await expect(host.sharedAgentAIConfigLocalOptions({ kind: 'local-loadouts', capabilityContract: 'text.generate', search: '' }))
      .resolves.toEqual({ kind: 'local-loadouts', options: [], truncated: false });
    await expect(host.agentManagerSnapshot({ agentHandle: handle, conversationAnchorId: 'anchor-1' }))
      .resolves.toMatchObject({
        lifecycleStatus: 'active', executionState: 'idle',
        actionAvailability: managerActionAvailability(),
      });
    await expect(host.agentAutonomySnapshot({ agentHandle: handle }))
      .resolves.toMatchObject({ autonomyRevision: '1' });
    await expect(host.agentUpdateAutonomy(autonomyUpdate))
      .resolves.toMatchObject({ autonomyRevision: '2' });
    await expect(host.agentPresentationSnapshot({ agentHandle: handle }))
      .resolves.toMatchObject({ presentationRevision: '1' });
    await expect(host.agentPresentationReadAsset({ agentHandle: handle, assetRef: 'vrm_0123456789ab' }))
      .resolves.toMatchObject({ assetRef: 'vrm_0123456789ab', role: 'avatar', backendKind: 'vrm' });
    await expect(host.agentCommitPresentation(presentationCommit)).resolves.toMatchObject({
      presentationRevision: '2',
      previousProfile: { backendKind: 'sprite2d', revision: '1' },
    });

    expect(calls).toEqual([
      { method: 'localAppSharedAgentAIConfigGet' },
      { method: 'localAppSharedAgentAIConfigOverwrite', input: { expectedRevision: '0', capabilities: [] } },
      { method: 'localAppSharedAgentAIConfigLocalOptions', input: { kind: 'local-loadouts', capabilityContract: 'text.generate', search: '' } },
      { method: 'localAppAgentManagerSnapshot', input: { agentHandle: handle, conversationAnchorId: 'anchor-1' } },
      { method: 'localAppAgentAutonomySnapshot', input: { agentHandle: handle } },
      { method: 'localAppAgentUpdateAutonomy', input: autonomyUpdate },
      { method: 'localAppAgentPresentationSnapshot', input: { agentHandle: handle } },
      { method: 'localAppAgentPresentationReadAsset', input: { agentHandle: handle, assetRef: 'vrm_0123456789ab' } },
      { method: 'localAppAgentCommitPresentation', input: presentationCommit },
    ]);
  });

  it('performs one bounded same-Host rebind on typed session invalidation', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    let sessionChanges = 0;
    let attempts = 0;
    const candidate = {
      ...binding(calls),
      localAppSessionRenew: async () => {
        calls.push({ method: 'localAppSessionRenew' });
        return { status: 'ok' as const, value: statusProjection() };
      },
      localAppStorageReadJson: async (input: unknown) => {
        calls.push({ method: 'localAppStorageReadJson', input });
        attempts++;
        return attempts === 1
          ? { status: 'error' as const, reasonCode: 'account-changed', retryable: false }
          : { status: 'error' as const, reasonCode: 'local-app-owner-unavailable', retryable: false };
      },
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate, () => { sessionChanges += 1; });
    await expect(host.storageReadJson({ relativePath: 'state.json' })).rejects.toMatchObject({
      reasonCode: 'local-app-owner-unavailable', retryable: false,
    });
    expect(calls).toEqual([
      { method: 'localAppStorageReadJson', input: { relativePath: 'state.json' } },
      { method: 'localAppSessionRenew' },
      { method: 'localAppStorageReadJson', input: { relativePath: 'state.json' } },
    ]);
    expect(sessionChanges).toBe(1);
  });

  it('repairs the native session without replaying a mutation after uncertain invalidation', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const candidate = {
      ...binding(calls),
      localAppSessionRenew: async () => {
        calls.push({ method: 'localAppSessionRenew' });
        return { status: 'ok' as const, value: statusProjection() };
      },
      localAppConversationOpen: async (input: unknown) => {
        calls.push({ method: 'localAppConversationOpen', input });
        return { status: 'error' as const, reasonCode: 'revoked', retryable: false };
      },
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.conversationOpen({ agentHandle: `agent_ref_${'a'.repeat(43)}` }))
      .rejects.toMatchObject({ reasonCode: 'revoked' });
    expect(calls).toEqual([
      { method: 'localAppConversationOpen', input: { agentHandle: `agent_ref_${'a'.repeat(43)}` } },
      { method: 'localAppSessionRenew' },
    ]);
  });

  it('renews once when the formal session status itself is revoked', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    let sessionChanges = 0;
    let statusAttempts = 0;
    const candidate = {
      ...binding(calls),
      localAppSessionStatus: async () => {
        calls.push({ method: 'localAppSessionStatus' });
        statusAttempts += 1;
        return statusAttempts === 1
          ? { status: 'error' as const, reasonCode: 'revoked', retryable: false }
          : { status: 'ok' as const, value: statusProjection() };
      },
      localAppSessionRenew: async () => {
        calls.push({ method: 'localAppSessionRenew' });
        return { status: 'ok' as const, value: statusProjection() };
      },
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate, () => { sessionChanges += 1; });

    await expect(host.sessionStatus()).resolves.toEqual(statusProjection());
    expect(calls).toEqual([
      { method: 'localAppSessionStatus' },
      { method: 'localAppSessionRenew' },
      { method: 'localAppSessionStatus' },
    ]);
    expect(sessionChanges).toBe(1);
  });

  it('does not disguise access denial as rebind or owner unavailability', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const candidate = {
      ...binding(calls),
      localAppStorageReadJson: async (input: unknown) => {
        calls.push({ method: 'localAppStorageReadJson', input });
        return { status: 'error' as const, reasonCode: 'local-app-access-denied', retryable: false };
      },
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).storageReadJson({
      relativePath: 'state.json',
    })).rejects.toMatchObject({ reasonCode: 'local-app-access-denied', retryable: false });
    expect(calls).toEqual([
      { method: 'localAppStorageReadJson', input: { relativePath: 'state.json' } },
    ]);
  });

  it('preserves typed unavailable errors without leaking native detail', async () => {
    const candidate = {
      ...binding([]),
      localAppConversationSendTurn: async () => ({
        status: 'error' as const,
        reasonCode: 'local-app-operation-unavailable',
        retryable: false,
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).conversationSendTurn({
      agentHandle: 'lash_one',
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      parts: [{ kind: 'text', text: 'hello' }],
    })).rejects.toMatchObject({ reasonCode: 'local-app-operation-unavailable', retryable: false });
  });

  it('preserves exact Local owner composition failures', async () => {
    const candidate = {
      ...binding([]),
      localAppTextGenerateCandidate: async () => ({
        status: 'error' as const,
        reasonCode: 'ai-local-selection-not-found',
        retryable: false,
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).textGenerateCandidate({
      messages: [{ role: 'user', text: 'hello' }], temperature: 0, topP: 1, maxTokens: 1,
    })).rejects.toMatchObject({
      reasonCode: 'ai-local-selection-not-found', retryable: false,
    });
  });

  it('preserves exact Local asset incompatibility failures', async () => {
    const candidate = {
      ...binding([]),
      localAppScenarioJobSubmit: async () => ({
        status: 'error' as const,
        reasonCode: 'ai-local-asset-incompatible',
        retryable: false,
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).scenarioJobSubmit({
      capabilityContract: 'audio.transcribe',
    })).rejects.toMatchObject({
      reasonCode: 'ai-local-asset-incompatible', retryable: false,
    });
  });

  it('preserves typed media validation failures', async () => {
    for (const reasonCode of [
      'ai-media-spec-invalid', 'ai-media-option-unsupported',
      'ai-face-reference-missing',
      'ai-face-reference-ambiguous',
      'ai-face-target-missing',
      'ai-face-target-ambiguous',
      'ai-video-decode-failed',
      'ai-video-encode-failed',
      'ai-video-session-overloaded',
      'ai-video-session-generation-invalid',
      'ai-local-execution-load-failed',
      'ai-local-execution-inference-failed',
      'ai-local-execution-canceled',
      'ai-local-execution-process-crashed',
      'ai-local-execution-content-mismatch',
      'ai-loadout-model-asset-content-mismatch',
      'ai-local-execution-out-of-memory',
    ]) {
      const candidate = {
        ...binding([]),
        localAppScenarioJobSubmit: async () => ({
          status: 'error' as const,
          reasonCode,
          retryable: false,
        }),
      };
      await expect(createNimiElectronLocalAppHostForBinding(candidate).scenarioJobSubmit({
        capabilityContract: 'video.generate',
      })).rejects.toMatchObject({ reasonCode, retryable: false });
    }
  });

  it('preserves exact presentation conflict and validation failures', async () => {
    for (const reasonCode of [
      'agent-presentation-revision-conflict',
      'agent-presentation-asset-structure-invalid',
      'agent-presentation-asset-too-large',
      'agent-presentation-asset-integrity-mismatch',
      'agent-presentation-backend-incompatible',
    ]) {
      const candidate = {
        ...binding([]),
        localAppAgentCommitPresentation: async () => ({
          status: 'error' as const,
          reasonCode,
          retryable: false,
        }),
      };
      await expect(createNimiElectronLocalAppHostForBinding(candidate).agentCommitPresentation({
        agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        expectedPresentationRevision: '1',
        intent: { clearResourcePackSelection: true },
        importedAssets: [],
      })).rejects.toMatchObject({ reasonCode, retryable: false });
    }
  });

  it('preserves exact typed voice failures', async () => {
    for (const reasonCode of [
      'ai-voice-input-invalid',
      'ai-voice-workflow-unsupported',
      'ai-voice-asset-not-found',
      'ai-voice-asset-expired',
      'ai-voice-asset-scope-forbidden',
      'ai-voice-target-model-mismatch',
      'ai-voice-job-not-found',
      'ai-voice-job-not-cancellable',
    ]) {
      const candidate = {
        ...binding([]),
        localAppScenarioJobSubmit: async () => ({
          status: 'error' as const,
          reasonCode,
          retryable: false,
        }),
      };
      await expect(createNimiElectronLocalAppHostForBinding(candidate).scenarioJobSubmit({
        spec: { type: 'voice-create' },
      })).rejects.toMatchObject({ reasonCode, retryable: false });
    }
  });

  it('rejects protected carrier material returned by the native binding', async () => {
    const candidate = {
      ...binding([]),
      localAppSessionStatus: async () => ({
        status: 'ok' as const,
        value: { ...statusProjection(), sessionId: 'forbidden' },
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).sessionStatus()).rejects.toMatchObject({
      reasonCode: 'runtime-service-untrusted', retryable: false,
    });
  });

  it('carries the native Realm Realtime envelope and rejects unknown envelope fields', async () => {
    const event = {
      realtimeSessionId: 'session-1', channelId: 'channel-1', subscriptionId: 'subscription-1',
      generation: '1', sequence: '1', correlationId: 'correlation-1',
      occurredAt: { seconds: '1', nanos: 0 },
      event: {
        type: 'presence', userId: 'user-1', isOnline: true,
        presenceRevision: '1', occurredAt: { seconds: '1', nanos: 0 },
      },
    };
    const hostFor = (value: unknown) => createNimiElectronLocalAppHostForBinding({
      ...binding([]),
      localAppRealtimeStreamNext: async () => ({ status: 'ok' as const, value }),
    });
    await expect(hostFor({ completed: false, event }).realtimeStreamNext({ streamId: 'realm-realtime-1' }))
      .resolves.toEqual({ completed: false, event });
    await expect(hostFor({ completed: false, event: { ...event, endpoint: 'http://localhost/private' } })
      .realtimeStreamNext({ streamId: 'realm-realtime-1' }))
      .rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
    await expect(hostFor({ completed: false, event: { event: event.event } })
      .realtimeStreamNext({ streamId: 'realm-realtime-1' }))
      .rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
  });

  it.each(['audio/wav', 'audio/mpeg'])('projects imported %s without expanding the owner request', async (mimeType) => {
    const calls: unknown[] = [];
    const host = createNimiElectronLocalAppHostForBinding({
      ...binding([]),
      localAppArtifactUpload: async (input) => {
        calls.push(input);
        return { status: 'ok' as const, value: { artifactId: 'audio-import-1', mimeType, sizeBytes: 2 } };
      },
    });
    await expect(host.artifactUpload({ bytes: [1, 2], mimeType })).resolves.toEqual({
      artifactId: 'audio-import-1', mimeType, sizeBytes: 2,
    });
    expect(calls).toEqual([{ bytes: Buffer.from([1, 2]), mimeType }]);
  });

  it('passes canonical audio references and validates the native sample facts', async () => {
    const calls: unknown[] = [];
    const metadata = { artifactId: 'canonical-1', sizeBytes: 73588090, mimeType: 'audio/wav',
      expiresAt: { seconds: '2000000000', nanos: 0 },
      audioInfo: { sampleRateHz: 48000, channels: 2, frameCount: 9198504, durationMs: 191635 } };
    const host = createNimiElectronLocalAppHostForBinding({ ...binding([]),
      localAppArtifactUpload: async (input) => { calls.push(input); return { status: 'ok' as const, value: metadata }; },
    });
    const input = { source: { kind: 'app-asset', relativePath: 'sources/原曲.mp3' }, mimeType: 'audio/mpeg',
      audioPreparation: { profile: 'canonical-pcm-v1' } };
    await expect(host.artifactUpload(input)).resolves.toEqual(metadata);
    expect(calls).toEqual([input]);
    const invalid = createNimiElectronLocalAppHostForBinding({ ...binding([]),
      localAppArtifactUpload: async () => ({ status: 'ok' as const, value: { ...metadata, audioInfo: { ...metadata.audioInfo, frameCount: 1 } } }),
    });
    await expect(invalid.artifactUpload(input)).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
  });

  it('strictly validates scenario Job and artifact projections', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));
    await expect(host.scenarioJobGet({ jobId: 'job-1' })).resolves.toEqual({
      job: scenarioJobProjection(), asset: null, voiceReference: null,
    });
    await expect(host.artifactRead({ artifactId: 'artifact-1' })).resolves.toEqual({
      bytes: [1, 2], mimeType: 'image/png', sizeBytes: 2,
    });
    await expect(host.artifactUpload({ bytes: [1, 2], mimeType: 'image/png' })).resolves.toEqual({
      artifactId: 'artifact-upload-1', mimeType: 'image/png', sizeBytes: 2,
    });
    await expect(host.assetReveal({ relativePath: 'media/run.wav' })).resolves.toEqual({ revealed: true });
    expect(calls.find(({ method }) => method === 'localAppArtifactUpload')?.input).toEqual({
      bytes: Buffer.from([1, 2]), mimeType: 'image/png',
    });

    const untrusted = {
      ...binding([]),
      localAppScenarioJobGet: async () => ({
        status: 'ok' as const,
        value: { job: { ...scenarioJobProjection(), provider: 'private' } },
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(untrusted).scenarioJobGet({ jobId: 'job-1' }))
      .rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
  });

  it('projects canonical voice-create Jobs and VoiceAsset creation sources only', async () => {
    const asset = {
      voiceAssetId: 'voice-asset-1', creationSource: 'reference-audio', status: 'active',
      createdAt: null, updatedAt: null, expiresAt: null,
    };
    const candidate = {
      ...binding([]),
      localAppScenarioJobSubmit: async () => ({
        status: 'ok' as const,
        value: { job: scenarioJobProjection({ scenarioType: 'voice-create', status: 'submitted' }) },
      }),
      localAppScenarioJobGet: async () => ({
        status: 'ok' as const,
        value: {
          job: scenarioJobProjection({ scenarioType: 'voice-create', status: 'completed' }),
          asset,
          voiceReference: { kind: 'voice_asset_id', voiceAssetId: asset.voiceAssetId },
        },
      }),
      localAppVoiceAssetsList: async () => ({
        status: 'ok' as const,
        value: { assets: [asset, { ...asset, voiceAssetId: 'voice-asset-2', creationSource: 'text-description' }], nextPageToken: '' },
      }),
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    await expect(host.scenarioJobSubmit({ spec: { type: 'voice-create' } })).resolves.toEqual({
      job: scenarioJobProjection({ scenarioType: 'voice-create', status: 'submitted' }),
    });
    await expect(host.scenarioJobGet({ jobId: 'job-1' })).resolves.toEqual({
      job: scenarioJobProjection({ scenarioType: 'voice-create', status: 'completed' }),
      asset,
      voiceReference: { kind: 'voice_asset_id', voiceAssetId: asset.voiceAssetId },
    });
    await expect(host.voiceAssetsList({ pageSize: 0, pageToken: '' })).resolves.toEqual({
      assets: [asset, { ...asset, voiceAssetId: 'voice-asset-2', creationSource: 'text-description' }],
      nextPageToken: '',
    });

    const legacy = {
      ...binding([]),
      localAppScenarioJobSubmit: async () => ({
        status: 'ok' as const,
        value: {
          job: scenarioJobProjection({ scenarioType: 'voice-clone' }),
          asset: { voiceAssetId: 'voice-asset-old', workflowType: 'voice-clone', status: 'active', createdAt: null, updatedAt: null, expiresAt: null },
        },
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(legacy).scenarioJobSubmit({ spec: {} }))
      .rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
  });

  it('accepts every legal Rust carrier Job stream projection', async () => {
    const baseJob = scenarioJobProjection({
      scenarioType: 'video-generate', status: 'submitted', progressPercent: 0,
      progressCurrentStep: 0, progressTotalSteps: 4,
    });
    const events = [
      { eventType: 'submitted', sequence: '1', traceId: 'trace-1', timestamp: null, job: baseJob },
      { eventType: 'running', sequence: '2', traceId: 'trace-1', timestamp: { seconds: '1786170000', nanos: 1 }, job: {
        ...baseJob, status: 'running', progressPercent: 50, progressCurrentStep: 2,
      } },
      { eventType: 'completed', sequence: '3', traceId: 'trace-1', timestamp: null, job: {
        ...baseJob, status: 'completed', progressPercent: 100, progressCurrentStep: 4,
        artifacts: [{
          artifactId: 'artifact-1', mimeType: 'video/mp4', bytes: [], sizeBytes: 1024,
          sha256: 'abc123', durationMs: 3000, width: 1280, height: 720,
          sampleRateHz: 0, channels: 0,
        }],
      } },
      { eventType: 'failed', sequence: '4', traceId: 'trace-1', timestamp: null, job: {
        ...baseJob, status: 'failed', reasonCode: 'runtime-call-failed',
        reasonDetail: 'provider execution failed',
      } },
    ];
    let index = 0;
    const candidate = {
      ...binding([]),
      localAppScenarioJobStreamNext: async () => ({
        status: 'ok' as const,
        value: { completed: false, event: events[index++] },
      }),
    };
    const host = createNimiElectronLocalAppHostForBinding(candidate);
    for (const event of events) {
      await expect(host.scenarioJobStreamNext({ streamId: 'scenario-job-1' }))
        .resolves.toEqual({ completed: false, event });
    }
  });

  it.each(['music-generate', 'world-generate'])('accepts the protected %s Job and stream projection', async (scenarioType) => {
    const event = {
      eventType: 'running',
      sequence: '1',
      traceId: 'trace-music-1',
      timestamp: { seconds: '1786170000', nanos: 1 },
      job: scenarioJobProjection({
        scenarioType,
        status: 'running',
        progressPercent: 0,
        progressCurrentStep: 0,
        progressTotalSteps: 0,
      }),
    };
    const candidate = {
      ...binding([]),
      localAppScenarioJobSubmit: async () => ({ status: 'ok' as const, value: { job: event.job } }),
      localAppScenarioJobStreamNext: async () => ({
        status: 'ok' as const,
        value: { completed: false, event },
      }),
    };

    await expect(createNimiElectronLocalAppHostForBinding(candidate).scenarioJobSubmit({ spec: {} }))
      .resolves.toEqual({ job: event.job });
    await expect(createNimiElectronLocalAppHostForBinding(candidate)
      .scenarioJobStreamNext({ streamId: 'scenario-job-music-1' }))
      .resolves.toEqual({ completed: false, event });
  });

  it('projects function-tool text output and stream items without treating business JSON as authority', async () => {
    const toolCall = { id: 'call-1', name: 'search', arguments: { token: 'business data' } };
    const output = { type: 'text-generate', items: [{ type: 'tool-call', toolCall }], finishReason: 'tool-calls' };
    const events = [
      { type: 'delta', sequence: '1', traceId: 'trace-tools', itemIndex: 0, text: 'Searching. ' },
      { type: 'tool-call', sequence: '2', traceId: 'trace-tools', itemIndex: 1, toolCall },
      { type: 'completed', sequence: '3', traceId: 'trace-tools', finishReason: 'tool-calls' },
    ];
    let index = 0;
    const host = createNimiElectronLocalAppHostForBinding({
      ...binding([]),
      localAppScenarioExecute: async () => ({ status: 'ok' as const, value: { output, traceId: 'trace-tools' } }),
      localAppTextTurnStreamNext: async () => ({ status: 'ok' as const, value: { completed: false, event: events[index++] } }),
    });
    await expect(host.scenarioExecute({ spec: {} })).resolves.toEqual({ output, traceId: 'trace-tools' });
    await host.textTurnSubscribe({ messages: [{ role: 'user', text: 'Search.' }] });
    for (const event of events) {
      await expect(host.textTurnStreamNext({ streamId: 'text-turn-1' })).resolves.toEqual({ completed: false, event });
    }
    await host.textTurnStreamClose({ streamId: 'text-turn-1' });
  });

  it('preserves typed text interruption and rejects provider fields on tool calls', async () => {
    const event = { type: 'failed', sequence: '1', traceId: 'trace-interrupted', reasonCode: 'ai-execution-interrupted', actionHint: 'retry',
      interruption: { cause: 'runtime-restart', resubmitDisposition: 'caller-may-resubmit' } };
    const host = createNimiElectronLocalAppHostForBinding({
      ...binding([]),
      localAppTextTurnStreamNext: async () => ({ status: 'ok' as const, value: { completed: false, event } }),
      localAppScenarioExecute: async () => ({ status: 'ok' as const, value: {
        output: { type: 'text-generate', items: [{ type: 'tool-call', toolCall: { id: 'c1', name: 'search', arguments: {}, providerMetadata: {} } }], finishReason: 'tool-calls' }, traceId: 'trace-invalid',
      } }),
    });
    await host.textTurnSubscribe({ messages: [{ role: 'user', text: 'Search.' }] });
    await expect(host.textTurnStreamNext({ streamId: 'text-turn-1' })).resolves.toEqual({ completed: false, event });
    await expect(host.scenarioExecute({ spec: {} })).rejects.toThrow();
  });

  it('carries bounded opaque continuity in ordered sync and stream outputs', async () => {
    const carrier = { kind: 'test.encrypted', version: 1, payload: [0, 255] };
    const event = { type: 'reasoning-continuity', sequence: '1', traceId: 'trace-continuity', itemIndex: 0, carrier };
    const output = { type: 'text-generate', items: [{ type: 'reasoning-continuity', carrier }, { type: 'text', text: 'Answer.' }], finishReason: 'stop' };
    const host = createNimiElectronLocalAppHostForBinding({
      ...binding([]),
      localAppScenarioExecute: async () => ({ status: 'ok' as const, value: { output, traceId: 'trace-continuity' } }),
      localAppTextTurnStreamNext: async () => ({ status: 'ok' as const, value: { completed: false, event } }),
    });
    await expect(host.scenarioExecute({ spec: {} })).resolves.toEqual({ output, traceId: 'trace-continuity' });
    await host.textTurnSubscribe({ messages: [{ role: 'user', text: 'Answer.' }] });
    await expect(host.textTurnStreamNext({ streamId: 'text-turn-1' })).resolves.toEqual({ completed: false, event });
    output.items.pop();
    await expect(host.scenarioExecute({ spec: {} })).rejects.toThrow();
    carrier.payload.push(256);
    await host.textTurnStreamClose({ streamId: 'text-turn-1' });
    await host.textTurnSubscribe({ messages: [{ role: 'user', text: 'Answer.' }] });
    await expect(host.textTurnStreamNext({ streamId: 'text-turn-1' })).rejects.toThrow();
  });

  it('preserves sync and streamed native content when JSON representation expands', async () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      type: 'reasoning', id: 'rs_budget', encrypted_content: 'A'.repeat(60 * 1024), summary: [],
    }));
    const carrier = { kind: 'openai_codex.responses.encrypted-reasoning', version: 1, payload: Array.from(payload) };
    const rawArguments = `{"values":[${Array(16 * 1024).fill('1e20').join(',')}]}`;
    const text = 'x'.repeat(100 * 1024);
    for (const args of [{ query: 'Nimi' }, JSON.parse(rawArguments)]) {
      const toolCall = { id: 'call-budget', name: 'search', arguments: args };
      const output = { type: 'text-generate', items: [{ type: 'reasoning-continuity', carrier }, { type: 'tool-call', toolCall }, { type: 'text', text }], finishReason: 'tool-calls' };
      const events = [
        { type: 'reasoning-continuity', sequence: '1', traceId: 'trace-budget', itemIndex: 0, carrier },
        { type: 'tool-call', sequence: '2', traceId: 'trace-budget', itemIndex: 1, toolCall },
        ...Array.from({ length: Math.ceil(text.length / (64 * 1024)) }, (_, index) => ({
          type: 'delta', sequence: String(index + 3), traceId: 'trace-budget', itemIndex: 2, text: text.slice(index * 64 * 1024, (index + 1) * 64 * 1024),
        })),
      ];
      let index = 0;
      const host = createNimiElectronLocalAppHostForBinding({
        ...binding([]),
        localAppScenarioExecute: async () => ({ status: 'ok' as const, value: { output, traceId: 'trace-budget' } }),
        localAppTextTurnStreamNext: async () => ({ status: 'ok' as const, value: { completed: false, event: events[index++] } }),
      });
      await expect(host.scenarioExecute({ spec: {} })).resolves.toEqual({ output, traceId: 'trace-budget' });
      await host.textTurnSubscribe({ messages: [{ role: 'user', text: 'Answer.' }] });
      for (let offset = 0; offset < events.length; offset++) {
        await expect(host.textTurnStreamNext({ streamId: 'text-turn-1' })).resolves.toEqual({ completed: false, event: events[offset] });
      }
      await host.textTurnStreamClose({ streamId: 'text-turn-1' });
    }
  });

  it('resolves only independently admitted fixed native binding package identities', () => {
    expect(resolveNimiElectronProtectedLocalBindingPackage('win32', 'x64')).toBe(
      '@nimiplatform/kit-protected-local-win32-x64',
    );
    expect(resolveNimiElectronProtectedLocalBindingPackage('darwin', 'arm64')).toBe(
      '@nimiplatform/kit-protected-local-darwin-arm64',
    );
    for (const [platform, architecture] of [['win32', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']]) {
      expect(() => resolveNimiElectronProtectedLocalBindingPackage(platform, architecture)).toThrow(
        expect.objectContaining({ reasonCode: 'protected-carrier-required', retryable: false }),
      );
    }
  });
});

function statusProjection() {
  return {
    state: 'ready', reasonCode: 'action-executed', retryable: false,
    currentUser: {
      state: 'ready',
      value: { handle: 'tester', displayName: 'Tester', avatarUrl: null },
      reasonCode: 'action-executed', retryable: false,
    },
  };
}

function scenarioJobProjection(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1', scenarioType: 'image-generate', status: 'running',
    progressPercent: 20, progressCurrentStep: 1, progressTotalSteps: 5,
    reasonCode: 'unspecified', reasonDetail: '', artifacts: [], traceId: 'trace-1',
    createdAt: null, updatedAt: null,
    transcriptionText: '',
    ...overrides,
  };
}

function managerActionAvailability() {
  return {
    getSharedAIConfig: { state: 'available', reason: null },
    overwriteSharedAIConfig: { state: 'available', reason: null },
    readAutonomy: { state: 'available', reason: null },
    updateAutonomy: { state: 'available', reason: null },
    inspectMemory: { state: 'available', reason: null },
    correctMemory: { state: 'unavailable', reason: 'memory-disabled' },
    forgetMemory: { state: 'available', reason: null },
    switchMemory: { state: 'available', reason: null },
    deleteAllMemory: { state: 'available', reason: null },
    replaceAppearance: { state: 'available', reason: null },
    restorePreviousAppearance: {
      state: 'unavailable', reason: 'previous-presentation-unavailable',
    },
  };
}

function binding(calls: Array<{ method: string; input?: unknown }>) {
  const record = (method: string, value: unknown) => async (input?: unknown) => {
    calls.push({ method, ...(input === undefined ? {} : { input }) });
    return { status: 'ok' as const, value };
  };
  return {
    localAppSessionStatus: record('localAppSessionStatus', statusProjection()),
    localAppSessionRenew: record('localAppSessionRenew', statusProjection()),
    localAppAIConfigGet: record('localAppAIConfigGet', {
      config: { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] },
      revision: '0', effectiveSelections: [],
    }),
    localAppAIConfigOverwrite: record('localAppAIConfigOverwrite', {}),
    localAppAIConfigLocalOptions: record('localAppAIConfigLocalOptions', {}),
    localAppTextGenerateCandidate: record('localAppTextGenerateCandidate', { text: 'hello', finishReason: 'stop', traceId: 'trace-1' }),
    localAppTextTurnSubscribe: record('localAppTextTurnSubscribe', { streamId: 'text-turn-1' }),
    localAppTextTurnStreamNext: record('localAppTextTurnStreamNext', { completed: true }),
    localAppTextTurnStreamClose: record('localAppTextTurnStreamClose', { closed: true }),
    localAppScenarioExecute: record('localAppScenarioExecute', {
      output: { type: 'text-embed', vectors: [[0.1, 0.2]], spaceId: 'space-test-1' }, traceId: 'trace-1',
    }),
    localAppScenarioJobSubmit: record('localAppScenarioJobSubmit', { job: scenarioJobProjection() }),
    localAppScenarioJobGet: record('localAppScenarioJobGet', { job: scenarioJobProjection(), asset: null, voiceReference: null }),
    localAppScenarioJobSubscribe: record('localAppScenarioJobSubscribe', { streamId: 'scenario-job-1' }),
    localAppScenarioJobStreamNext: record('localAppScenarioJobStreamNext', { completed: true }),
    localAppScenarioJobStreamClose: record('localAppScenarioJobStreamClose', { closed: true }),
    localAppScenarioJobCancel: record('localAppScenarioJobCancel', { job: scenarioJobProjection() }),
    localAppArtifactRead: record('localAppArtifactRead', { bytes: [1, 2], mimeType: 'image/png', sizeBytes: 2 }),
    localAppArtifactUpload: record('localAppArtifactUpload', { artifactId: 'artifact-upload-1', sizeBytes: 2, mimeType: 'image/png' }),
    localAppVoiceAssetsList: record('localAppVoiceAssetsList', { assets: [], nextPageToken: '' }),
    localAppRealmWorldCoreList: record('localAppRealmWorldCoreList', [{ id: 'world-1', visibility: 'private' }]),
    localAppRealmWorldCoreCreate: record('localAppRealmWorldCoreCreate', { id: 'world-2', visibility: 'private' }),
    localAppRealmWorldCreationEligibilityGet: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldCoreGet: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldCoreReplace: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldCharacterList: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldCharacterGet: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldCharacterCreate: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldCharacterReplace: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldEntityList: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldEntityGet: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldEntityCreate: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldRelationshipList: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmWorldRelationshipGet: async () => ({ status: 'error' as const, reasonCode: 'not-found', retryable: false }),
    localAppRealmPersonaCharacterListOwned: record('localAppRealmPersonaCharacterListOwned', [personaProjection()]),
    localAppRealmPersonaCharacterGetOwned: record('localAppRealmPersonaCharacterGetOwned', personaProjection()),
    localAppRealmPersonaCharacterCreate: record('localAppRealmPersonaCharacterCreate', personaProjection()),
    localAppRealmPersonaCharacterReplace: record('localAppRealmPersonaCharacterReplace', personaProjection()),
    localAppRealmPersonaCharacterDelete: record('localAppRealmPersonaCharacterDelete', { personaCharacterId: 'persona-1', deleted: true }),
    localAppRealmChatList: record('localAppRealmChatList', { items: [], nextCursor: null }),
    localAppRealmRealtimeOpen: record('localAppRealmRealtimeOpen', {}),
    localAppRealmRealtimeSubscribe: record('localAppRealmRealtimeSubscribe', { streamId: 'realm-realtime-1' }),
    localAppRealmRealtimeAck: record('localAppRealmRealtimeAck', {}),
    localAppRealmRealtimeSubscriptionClose: record('localAppRealmRealtimeSubscriptionClose', {}),
    localAppRealmRealtimeChannelClose: record('localAppRealmRealtimeChannelClose', {}),
    localAppAgentReferenceList: record('localAppAgentReferenceList', [{
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      displayName: 'Agent One',
      avatarUrl: null,
    }]),
    localAppAvatarHostTargetResolve: record('localAppAvatarHostTargetResolve', {
      avatarHostTargetRef: 'avatar_target_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    }),
    localAppSharedAgentAIConfigGet: record('localAppSharedAgentAIConfigGet', {
      config: { owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } }, capabilities: [] },
      revision: '0', effectiveSelections: [],
    }),
    localAppSharedAgentAIConfigOverwrite: record('localAppSharedAgentAIConfigOverwrite', {
      outcome: 'committed',
      config: { owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } }, capabilities: [] },
      revision: '1', effectiveSelections: [], reasonCode: 'REASON_CODE_UNSPECIFIED',
    }),
    localAppSharedAgentAIConfigLocalOptions: record('localAppSharedAgentAIConfigLocalOptions', {
      kind: 'local-loadouts', options: [], truncated: false,
    }),
    localAppAgentManagerSnapshot: record('localAppAgentManagerSnapshot', {
      lifecycleStatus: 'active', executionState: 'idle', statusText: '', currentEmotion: '',
      source: null, context: null, actionAvailability: managerActionAvailability(),
    }),
    localAppAgentAutonomySnapshot: record('localAppAgentAutonomySnapshot', {
      enabled: false, config: null, usedTokensInWindow: 0, budgetExhausted: false,
      autonomyRevision: '1',
    }),
    localAppAgentUpdateAutonomy: record('localAppAgentUpdateAutonomy', {
      enabled: true, config: null, usedTokensInWindow: 0, budgetExhausted: false,
      autonomyRevision: '2',
    }),
    localAppAgentPresentationSnapshot: record('localAppAgentPresentationSnapshot', {
      profile: null, previousProfile: null, defaultVoiceReference: '', avatarAutoplay: false, presentationRevision: '1',
    }),
    localAppAgentPresentationReadAsset: record('localAppAgentPresentationReadAsset', {
      assetRef: 'vrm_0123456789ab', role: 'avatar', backendKind: 'vrm',
      fileName: 'avatar.vrm', mediaType: 'model/gltf-binary', content: [1, 2, 3], sha256: 'a'.repeat(64),
    }),
    localAppAgentCommitPresentation: record('localAppAgentCommitPresentation', {
      profile: null,
      previousProfile: {
        backendKind: 'sprite2d', avatarAssetRef: 'asset://previous', expressionProfileRef: '',
        idlePreset: '', interactionPolicyRef: '', defaultVoiceReference: '',
        avatarAutoplay: false, backgroundAssetRef: '', revision: '1',
      },
      defaultVoiceReference: '',
      presentationRevision: '2',
    }),
    localAppAgentMemoryInspect: record('localAppAgentMemoryInspect', {
      outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
      currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
    }),
    localAppAgentMemoryCorrect: record('localAppAgentMemoryCorrect', {
      outcome: 'committed', affectedMemoryIds: [], projection: null,
    }),
    localAppAgentMemoryForget: record('localAppAgentMemoryForget', {
      outcome: 'forgotten', affectedMemoryIds: [], projection: null,
    }),
    localAppAgentMemorySwitch: record('localAppAgentMemorySwitch', {
      outcome: 'committed', affectedMemoryIds: [], projection: null,
    }),
    localAppAgentMemoryDelete: record('localAppAgentMemoryDelete', {
      outcome: 'deleted', affectedMemoryIds: [], projection: null,
    }),
    localAppStorageReadJson: record('localAppStorageReadJson', { value: { version: 1 }, sizeBytes: 13 }),
    localAppStorageWriteJson: record('localAppStorageWriteJson', { value: { version: 2 }, sizeBytes: 13 }),
    localAppStorageRemoveJson: record('localAppStorageRemoveJson', { removed: false }),
    localAppAssetStat: record('localAppAssetStat', assetProjection()),
    localAppAssetList: record('localAppAssetList', { assets: [assetProjection()], nextCursor: '' }),
    localAppAssetWriteOpen: record('localAppAssetWriteOpen', { streamId: 'asset-write-1' }),
    localAppAssetWriteChunk: record('localAppAssetWriteChunk', { accepted: true }),
    localAppAssetWriteCommit: record('localAppAssetWriteCommit', assetProjection()),
    localAppAssetWriteAbort: record('localAppAssetWriteAbort', { closed: true }),
    localAppAssetReadOpen: record('localAppAssetReadOpen', {
      streamId: 'asset-read-1', asset: assetProjection(), range: { offset: 0, length: 3, totalSize: 3 },
    }),
    localAppAssetReadNext: async () => ({ status: 'ok' as const, value: null, completed: true }),
    localAppAssetReadClose: record('localAppAssetReadClose', { closed: true }),
    localAppAssetRemove: record('localAppAssetRemove', { removed: true }),
    localAppAssetMove: record('localAppAssetMove', assetProjection()),
    localAppAssetReveal: record('localAppAssetReveal', { revealed: true }),
    localAppAssetAdopt: record('localAppAssetAdopt', assetProjection()),
    localAppConversationOpen: record('localAppConversationOpen', { conversationAnchorId: 'anchor-1', activeTurnId: null }),
    localAppConversationSendTurn: record('localAppConversationSendTurn', { turnId: 'turn-1' }),
    localAppConversationAttachmentUpload: record('localAppConversationAttachmentUpload', {
      artifactId: 'artifact-1', expiresAt: '2026-08-23T09:00:00Z',
    }),
    localAppConversationArtifactRead: record('localAppConversationArtifactRead', {
      artifactId: 'artifact-1', bytes: [1, 2, 3], mimeType: 'image/png', byteLength: 3,
    }),
    localAppConversationVoiceTranscribe: record('localAppConversationVoiceTranscribe', {
      text: 'transcribed intent',
    }),
    localAppConversationVoiceTranscribeCancel: record('localAppConversationVoiceTranscribeCancel', {
      canceled: true,
    }),
    localAppConversationVoiceRender: record('localAppConversationVoiceRender', {
      voice: {
        voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-1', state: 'ready',
        artifactId: 'artifact-voice-1', reasonCode: null, message: null,
      },
    }),
    localAppConversationInterruptTurn: record('localAppConversationInterruptTurn', { turnId: 'turn-1' }),
    localAppConversationSubscribe: record('localAppConversationSubscribe', { streamId: 'conversation-1' }),
    localAppConversationStreamNext: record('localAppConversationStreamNext', { completed: true }),
    localAppConversationStreamClose: record('localAppConversationStreamClose', { closed: true }),
    localAppConversationSnapshot: record('localAppConversationSnapshot', {
      conversationAnchorId: 'anchor-1', activeTurnId: null, messages: [], truncatedBefore: false,
    }),
    localAppEmbodimentSnapshot: record('localAppEmbodimentSnapshot', {
      sequence: '1', observedAt: { seconds: '1', nanos: 0 }, provenance: 'runtime_agent_owner',
      activity: null, emotion: null, posture: null, voiceTiming: null,
    }),
    localAppEmbodimentSubscribe: record('localAppEmbodimentSubscribe', { streamId: 'embodiment-1' }),
    localAppAiRealtimeOpen: record('localAppAiRealtimeOpen', {}),
    localAppVideoSessionOpen: record('localAppVideoSessionOpen', {}),
    localAppVideoSessionSubmit: record('localAppVideoSessionSubmit', {}),
    localAppVideoSessionRead: record('localAppVideoSessionRead', {}),
    localAppVideoSessionClose: record('localAppVideoSessionClose', {}),
    localAppAiRealtimeAppendInput: record('localAppAiRealtimeAppendInput', {}),
    localAppAiRealtimeSubmitOwnerControl: record('localAppAiRealtimeSubmitOwnerControl', {}),
    localAppAiRealtimeSubscribe: record('localAppAiRealtimeSubscribe', { streamId: 'ai-realtime-1' }),
    localAppAiRealtimeInterruptOutput: record('localAppAiRealtimeInterruptOutput', {}),
    localAppAiRealtimeClose: record('localAppAiRealtimeClose', {}),
    localAppAgentRealtimeOpen: record('localAppAgentRealtimeOpen', {}),
    localAppAgentRealtimeAppendInput: record('localAppAgentRealtimeAppendInput', {}),
    localAppAgentRealtimeSubscribe: record('localAppAgentRealtimeSubscribe', { streamId: 'agent-realtime-1' }),
    localAppAgentRealtimeStatus: record('localAppAgentRealtimeStatus', {}),
    localAppAgentRealtimeInterruptOutput: record('localAppAgentRealtimeInterruptOutput', {}),
    localAppAgentRealtimeClose: record('localAppAgentRealtimeClose', {}),
    localAppRealtimeStreamNext: record('localAppRealtimeStreamNext', { completed: true }),
    localAppRealtimeStreamClose: record('localAppRealtimeStreamClose', { closed: true }),
  };
}

function personaProjection() {
  return {
    id: 'persona-1', worldId: 'world-1', schemaVersion: 'realm.persona-character-core/v1',
    contentHash: 'a'.repeat(64), contentRevision: 1, sourceHash: 'b'.repeat(64), visibility: 'private',
    origin: { kind: 'manual' },
    lorebookDeclaration: personaLorebookDeclaration(),
    profile: {
      ...personaProfileInput(),
      profileHash: 'c'.repeat(64),
      profileCoverage: {
        manifestSchemaVersion: 'realm.character-profile-coverage/v1',
        requiredSections: [], optionalSections: [], requiredRefs: [], optionalRefs: [], diagnostics: [],
        aggregateStatus: 'complete', profileCoverageHash: 'd'.repeat(64),
      },
    },
    validity: { status: 'valid', issues: [] },
    materializationReadiness: { status: 'ready', blockers: [] },
    createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function personaLorebookDeclaration() {
  return {
    identity: 'Owner PersonaCharacter acceptance',
    behavior: ['Stay practical.'],
    speaking: ['Speak clearly.'],
    immutableBoundaries: ['Do not invent source facts.'],
    relationshipPostures: [],
  };
}

function personaProfileInput() {
  return {
    profileSchemaVersion: 'realm.character-profile-core/v1',
    identity: { name: 'Persona', summary: 'line one\nline two' },
    presentation: { displayName: 'Persona' },
    narrative: { summary: 'Narrative' },
    interactionProfile: { interactionModes: [] },
    assets: {
      resourceRefs: [], intents: [],
      externalRefs: [{ refId: 'avatar', kind: 'image', uri: 'https://cdn.example/avatar.png?size=large' }],
    },
    authoring: {
      source: 'test',
      extensions: {
        'works.nimi.role-setting': {
          extensionSchemaVersion: 'role-setting/v1', namespace: 'works.nimi.role-setting', productSemantic: true,
          fields: { endpoint: 'story-chapter', route: 'east-road' },
        },
      },
    },
  };
}

function assetProjection() {
  return {
    relativePath: 'media/example.png', mediaType: 'image/png', sizeBytes: 3,
    sha256: `sha256:${'a'.repeat(64)}`, createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
  };
}
