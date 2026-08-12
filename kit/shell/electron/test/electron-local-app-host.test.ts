import { describe, expect, it, vi } from 'vitest';

import {
  createNimiElectronLocalAppHostForBinding,
  primeNimiElectronLocalAppHost,
  resolveNimiElectronProtectedLocalBindingPackage,
  startNimiElectronLocalAppHostMaintenance,
} from '../src/main/local-app-host.js';

describe('Electron protected local-app host', () => {
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
      'agentAutonomySnapshot',
      'agentUpdateAutonomy',
      'agentPresentationSnapshot',
      'agentCommitPresentation',
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
    await expect(host.conversationOpen({ agentHandle: 'lash_one' }))
      .resolves.toEqual({ conversationAnchorId: 'anchor-1', activeTurnId: null });

    expect(calls.map(({ method }) => method)).toEqual([
      'localAppSessionStatus',
      'localAppRealmWorldCoreList',
      'localAppStorageReadJson',
      'localAppAgentReferenceList',
      'localAppConversationOpen',
    ]);
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

    await expect(host.sharedAgentAIConfigGet()).resolves.toMatchObject({ capabilities: [] });
    await expect(host.sharedAgentAIConfigOverwrite({ capabilities: [] }))
      .resolves.toMatchObject({ capabilities: [] });
    await expect(host.agentAutonomySnapshot({ agentHandle: handle }))
      .resolves.toMatchObject({ autonomyRevision: '1' });
    await expect(host.agentUpdateAutonomy(autonomyUpdate))
      .resolves.toMatchObject({ autonomyRevision: '2' });
    await expect(host.agentPresentationSnapshot({ agentHandle: handle }))
      .resolves.toMatchObject({ presentationRevision: '1' });
    await expect(host.agentCommitPresentation(presentationCommit)).resolves.toMatchObject({
      presentationRevision: '2',
      previousProfile: { backendKind: 'sprite2d', revision: '1' },
    });

    expect(calls).toEqual([
      { method: 'localAppSharedAgentAIConfigGet' },
      { method: 'localAppSharedAgentAIConfigOverwrite', input: { capabilities: [] } },
      { method: 'localAppAgentAutonomySnapshot', input: { agentHandle: handle } },
      { method: 'localAppAgentUpdateAutonomy', input: autonomyUpdate },
      { method: 'localAppAgentPresentationSnapshot', input: { agentHandle: handle } },
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
      text: 'hello',
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
    for (const reasonCode of ['ai-media-spec-invalid', 'ai-media-option-unsupported']) {
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

function binding(calls: Array<{ method: string; input?: unknown }>) {
  const record = (method: string, value: unknown) => async (input?: unknown) => {
    calls.push({ method, ...(input === undefined ? {} : { input }) });
    return { status: 'ok' as const, value };
  };
  return {
    localAppSessionStatus: record('localAppSessionStatus', statusProjection()),
    localAppSessionRenew: record('localAppSessionRenew', statusProjection()),
    localAppAIConfigGet: record('localAppAIConfigGet', { owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } }, capabilities: [] }),
    localAppModelConfigLocalSelectionsGet: record('localAppModelConfigLocalSelectionsGet', [{
      capabilityContract: 'text.generate', state: 'selected', configurationId: null,
      displayName: 'gemma4-26b', supportedFeatures: [], reasons: [],
      effectiveDefaults: { temperature: '0.8' },
    }]),
    localAppTextGenerateCandidate: record('localAppTextGenerateCandidate', { text: 'hello', finishReason: 'stop', traceId: 'trace-1' }),
    localAppTextTurnSubscribe: record('localAppTextTurnSubscribe', { streamId: 'text-turn-1' }),
    localAppTextTurnStreamNext: record('localAppTextTurnStreamNext', { completed: true }),
    localAppTextTurnStreamClose: record('localAppTextTurnStreamClose', { closed: true }),
    localAppScenarioExecute: record('localAppScenarioExecute', {
      output: { type: 'text-embed', vectors: [[0.1, 0.2]] }, traceId: 'trace-1',
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
    localAppAgentReferenceList: record('localAppAgentReferenceList', [{
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      displayName: 'Agent One',
      avatarUrl: null,
    }]),
    localAppSharedAgentAIConfigGet: record('localAppSharedAgentAIConfigGet', {
      owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
      capabilities: [],
    }),
    localAppSharedAgentAIConfigOverwrite: record('localAppSharedAgentAIConfigOverwrite', {
      owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
      capabilities: [],
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
      profile: null, previousProfile: null, defaultVoiceReference: '', presentationRevision: '1',
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
    localAppAssetAdopt: record('localAppAssetAdopt', assetProjection()),
    localAppConversationOpen: record('localAppConversationOpen', { conversationAnchorId: 'anchor-1', activeTurnId: null }),
    localAppConversationSendTurn: record('localAppConversationSendTurn', { turnId: 'turn-1' }),
    localAppConversationInterruptTurn: record('localAppConversationInterruptTurn', { turnId: 'turn-1' }),
    localAppConversationSubscribe: record('localAppConversationSubscribe', { streamId: 'conversation-1' }),
    localAppConversationStreamNext: record('localAppConversationStreamNext', { completed: true }),
    localAppConversationStreamClose: record('localAppConversationStreamClose', { closed: true }),
    localAppConversationSnapshot: record('localAppConversationSnapshot', {
      conversationAnchorId: 'anchor-1', activeTurnId: null, messages: [], truncatedBefore: false,
    }),
  };
}

function assetProjection() {
  return {
    relativePath: 'media/example.png', mediaType: 'image/png', sizeBytes: 3,
    sha256: `sha256:${'a'.repeat(64)}`, createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
  };
}
