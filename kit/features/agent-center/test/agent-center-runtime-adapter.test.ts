import { describe, expect, it } from 'vitest';
import type {
  NimiCapabilityAIConfig,
  NimiAIConfigEffectiveSelection,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationProfile,
  NimiSharedLocalAgentAIConfigSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import { createAppAgentCenterSession } from '../src/session.js';
import type { AgentCenterSharedAIConfigProjection, AgentCenterSession } from '../src/types.js';

const HANDLE = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
] as const;

function sharedConfig(
  capabilities: NimiCapabilityAIConfig['capabilities'] = [
    {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local', local: {} },
      requiredFeatures: [],
    },
  ],
): NimiCapabilityAIConfig {
  return {
    owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
    capabilities,
  };
}

function sharedProjection(
  capabilities: NimiCapabilityAIConfig['capabilities'] = sharedConfig().capabilities,
  revision = '1',
): AgentCenterSharedAIConfigProjection {
  return {
    aiConfig: sharedConfig(capabilities),
    revision,
    intents: capabilities.map((entry) => ({
      capability: entry.capabilityContract,
      route: entry.route.oneofKind === 'cloud' ? 'cloud' : 'local',
      requiredFeatures: entry.requiredFeatures,
    })),
  };
}

function localEffectiveSelection(
  loadoutRef: string,
  label: string,
): NimiAIConfigEffectiveSelection {
  return {
    capabilityContract: 'text.generate',
    state: 'ready',
    resource: {
      oneofKind: 'local',
      local: {
        loadoutRef,
        label,
        capabilityContract: 'text.generate',
        implementation: {
          implementationId: loadoutRef,
          driverId: 'local',
          driverDialect: 'test/local/v1',
        },
        supportedFeatures: [],
        state: 'ready',
        reasons: [],
      },
    },
    reasons: [],
  };
}

function appClient(calls: unknown[]): NimiLocalAppAgentConfigureClient {
  let config = sharedConfig();
  let autonomyRevision = '1';
  let presentationRevision = '1';
  let presentationProfile: NimiLocalAppAgentPresentationProfile = {
    backendKind: 'sprite2d' as const,
    avatarAssetRef: 'avatar-1',
    expressionProfileRef: '',
    idlePreset: '',
    interactionPolicyRef: '',
    defaultVoiceReference: 'voice-1',
    avatarAutoplay: false,
    backgroundAssetRef: '',
    revision: presentationRevision,
  };
  return {
    sharedAIConfig: {
      async get() {
        calls.push(['shared.get']);
        return { config, revision: '1', effectiveSelections: [], participation: PARTICIPATION };
      },
      async overwrite(input) {
        calls.push(['shared.overwrite', input]);
        config = sharedConfig([...input.capabilities]);
        return { outcome: 'committed', config, revision: '2', participation: PARTICIPATION };
      },
      async listOptions(query) {
        calls.push(['shared.listOptions', query]);
        if (query.kind === 'preset-voices') {
          return {
            kind: 'preset-voices', truncated: false,
            options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
          };
        }
        return { kind: 'local-loadouts', options: [], truncated: false };
      },
    },
    autonomy: {
      async snapshot(input) {
        calls.push(['autonomy.snapshot', input]);
        return {
          enabled: true,
          config: { mode: 'low', dailyTokenBudget: 100, maxTokensPerHook: 10 },
          usedTokensInWindow: 1,
          budgetExhausted: false,
          autonomyRevision,
        };
      },
      async update(input) {
        calls.push(['autonomy.update', input]);
        autonomyRevision = String(BigInt(autonomyRevision) + 1n);
        return {
          enabled: input.intent.enabled ?? true,
          config: input.intent.config ?? null,
          usedTokensInWindow: 1,
          budgetExhausted: false,
          autonomyRevision,
        };
      },
    },
    presentation: {
      async snapshot(input) {
        calls.push(['presentation.snapshot', input]);
        return {
          profile: { ...presentationProfile, revision: presentationRevision },
          previousProfile: null,
          defaultVoiceReference: presentationProfile.defaultVoiceReference,
          avatarAutoplay: presentationProfile.avatarAutoplay,
          presentationRevision,
        };
      },
      async commit(input) {
        calls.push(['presentation.commit', input]);
        presentationRevision = String(BigInt(presentationRevision) + 1n);
        presentationProfile = {
          ...presentationProfile,
          ...input.intent,
          revision: presentationRevision,
        } as NimiLocalAppAgentPresentationProfile;
        return {
          profile: { ...presentationProfile, revision: presentationRevision },
          previousProfile: null,
          defaultVoiceReference: presentationProfile.defaultVoiceReference,
          avatarAutoplay: presentationProfile.avatarAutoplay,
          presentationRevision,
        };
      },
    },
    memory: {
      async inspect(input) {
        calls.push(['memory.inspect', input]);
        return {
          outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
          currentCount: 0, supersededCount: 0, forgottenCount: 0,
        };
      },
      async correct(input) {
        calls.push(['memory.correct', input]);
        return { outcome: 'committed', affectedMemoryIds: [input.memoryId], projection: await this.inspect(input) };
      },
      async forget(input) {
        calls.push(['memory.forget', input]);
        return { outcome: 'forgotten', affectedMemoryIds: input.memoryIds, projection: await this.inspect(input) };
      },
      async setEnabled(input) {
        calls.push(['memory.setEnabled', input]);
        return { outcome: 'committed', affectedMemoryIds: [], projection: { ...await this.inspect(input), enabled: input.enabled } };
      },
      async deleteAll(input) {
        calls.push(['memory.deleteAll', input]);
        return { outcome: 'deleted', affectedMemoryIds: [], projection: { ...await this.inspect(input), outcome: 'deleted' } };
      },
    },
    manager: {
      async snapshot(input) {
        calls.push(['manager.snapshot', input]);
        return {
          lifecycleStatus: 'active',
          executionState: 'idle',
          statusText: 'Ready',
          currentEmotion: 'calm',
          source: {
            ready: true, state: 'ready', reasonCode: 'none',
            capturedAt: { seconds: '1750000000', nanos: 0 },
            coverageSections: [{
              section: 'identity', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0,
            }],
            lorebookReady: true, lorebookItemCount: 1, lorebookEstimatedTokens: '64',
          },
          context: {
            ready: true, state: 'ready', reasonCode: 'none',
            lanes: [{
              laneId: 'source_identity', state: 'included', includedItemCount: 1,
              omittedItemCount: 0, truncatedItemCount: 0, allocatedTokens: '64', usedTokens: '32',
            }],
            inputBudgetTokens: '1024', usedTokens: '32', requiredInputTokens: '32',
            requiredContextWindowTokens: '256',
            truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
            transcriptTurnCount: 1, memoryItemCount: 0, mediaCount: 0, toolCount: 0,
            sourceAdapterStatus: 'ready', sourceSelectionStatus: 'ready',
            conversationSummaryStatus: 'absent', privateRecallCount: 0,
          },
        };
      },
    },
  };
}

describe('AgentCenterSession', () => {
  it('keeps a committed mutation authoritative when the effective follow-up read fails', async () => {
    const calls: string[] = [];
    let projection = sharedProjection();
    let rejectReads = false;
    const base = appClient([]);
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: {
        ...base,
      sharedAIConfig: {
          ...base.sharedAIConfig,
        async get() {
          calls.push('read');
          if (rejectReads) throw new Error('follow-up read must not decide commit success');
          return {
            config: projection.aiConfig,
            revision: projection.revision,
            effectiveSelections: [localEffectiveSelection('loadout:text', 'Text A')],
            participation: PARTICIPATION,
          };
        },
        async overwrite(input) {
          calls.push('overwrite');
          projection = sharedProjection([...input.capabilities], '2');
          rejectReads = true;
          return {
            outcome: 'committed' as const,
            config: projection.aiConfig,
            revision: projection.revision,
            participation: PARTICIPATION,
          };
        },
      },
      },
    });
    await session.refresh();
    await session.overwriteSharedAIConfig({ expectedRevision: '1', capabilities: [] });
    await Promise.resolve();
    expect(calls).toEqual(['read', 'overwrite', 'read']);
    expect(session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities).toEqual([]);
    expect(session.getSnapshot().state.sharedAIConfig?.revision).toBe('2');
    expect(session.getSnapshot().state.effectiveSelections).toEqual([]);
    expect(session.getSnapshot().phase).toBe('ready');
  });

  it('invalidates stale effective facts and restores only the matching committed revision', async () => {
    const intentA = {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local' as const, local: {} },
      requiredFeatures: [] as string[],
      defaults: {
        fields: { temperature: { kind: { oneofKind: 'numberValue' as const, numberValue: 0.1 } } },
      },
    };
    const intentB = {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local' as const, local: {} },
      requiredFeatures: [] as string[],
      defaults: {
        fields: { temperature: { kind: { oneofKind: 'numberValue' as const, numberValue: 0.2 } } },
      },
    };
    let projection = sharedProjection([intentA], '1');
    let readCount = 0;
    let resolveFollowUp!: (value: NimiSharedLocalAgentAIConfigSnapshot) => void;
    const base = appClient([]);
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: {
        ...base,
      sharedAIConfig: {
          ...base.sharedAIConfig,
        async get() {
          readCount += 1;
          if (readCount === 1) {
            return {
              config: projection.aiConfig,
              revision: projection.revision,
              effectiveSelections: [localEffectiveSelection('loadout:a', 'Text A')],
              participation: PARTICIPATION,
            };
          }
          return new Promise((resolve) => {
            resolveFollowUp = resolve;
          });
        },
        async overwrite() {
          projection = sharedProjection([intentB], '2');
          return {
            outcome: 'committed' as const,
            config: projection.aiConfig,
            revision: projection.revision,
            participation: PARTICIPATION,
          };
        },
      },
      },
    });

    await session.refresh();
    expect(session.getSnapshot().state.effectiveSelections?.[0]?.resource).toMatchObject({
      oneofKind: 'local',
      local: { loadoutRef: 'loadout:a', label: 'Text A' },
    });

    await session.overwriteSharedAIConfig({ expectedRevision: '1', capabilities: [intentB] });
    expect(session.getSnapshot().state.sharedAIConfig?.revision).toBe('2');
    expect(session.getSnapshot().state.effectiveSelections).toEqual([]);

    resolveFollowUp({
      config: projection.aiConfig,
      revision: projection.revision,
      effectiveSelections: [localEffectiveSelection('loadout:b', 'Text B')],
      participation: PARTICIPATION,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.getSnapshot().state.effectiveSelections?.[0]?.resource).toMatchObject({
      oneofKind: 'local',
      local: { loadoutRef: 'loadout:b', label: 'Text B' },
    });
  });

  it('binds a covered App session to the SDK nominal handle and canonical configuration operations', async () => {
    const calls: unknown[] = [];
    const session = createAppAgentCenterSession({ handle: HANDLE, client: appClient(calls) });
    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      error: null,
      availability: {
        getSharedAIConfig: { state: 'available' },
        overwriteSharedAIConfig: { state: 'available' },
        readAutonomy: { state: 'available' },
        updateAutonomy: { state: 'available' },
        replaceAppearance: { state: 'available' },
        restorePreviousAppearance: {
          state: 'unavailable',
          reason: 'selection-required',
          nextStep: 'openRuntimeSettings',
        },
      },
    });
    expect(session.getSnapshot().state.effectiveSelections).toEqual([]);
    expect(session.getSnapshot().state.appearance.voiceCatalog).toMatchObject({
      state: 'ready',
      sourceLabel: 'Shared LocalAgent preset voices',
      options: [{ reference: 'preset_voice_id:serena', kind: 'preset_voice_id', name: 'Serena' }],
    });
    expect(calls).toContainEqual(['shared.listOptions', { kind: 'preset-voices' }]);
    expect(calls).toContainEqual(['autonomy.snapshot', { agentHandle: HANDLE }]);
    expect(calls).toContainEqual(['presentation.snapshot', { agentHandle: HANDLE }]);
    expect(calls).toContainEqual(['manager.snapshot', { agentHandle: HANDLE }]);
    expect(session.getSnapshot().state.cognition).toMatchObject({
      lifecycleStatus: 'active', executionState: 'idle', statusText: 'Ready', currentEmotion: 'calm',
    });
    expect(session.getSnapshot().state.sourceContext.context).toMatchObject({
      sourceAdapterStatus: 'ready', sourceSelectionStatus: 'ready', conversationSummaryStatus: 'absent',
    });
    expect(JSON.stringify(calls)).not.toMatch(/ownerUserId|runtimeSourceRef|localAgentRef/u);
    expect(JSON.stringify(session.getSnapshot().state)).not.toMatch(
      /promptHash|reservedReasoningTokens|generation|sourceHash|snapshotHash|provider|storage/u,
    );
  });

  it('lets a covered App set voice and autoplay without fabricating an Avatar profile', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    let revision = '0';
    let defaultVoiceReference = '';
    let avatarAutoplay = false;
    let profile: Awaited<ReturnType<NimiLocalAppAgentConfigureClient['presentation']['snapshot']>>['profile'] = null;
    let previousProfile: Awaited<ReturnType<NimiLocalAppAgentConfigureClient['presentation']['snapshot']>>['previousProfile'] = null;
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        async snapshot(input) {
          calls.push(['presentation.snapshot', input]);
          return {
            profile,
            previousProfile,
            defaultVoiceReference,
            avatarAutoplay,
            presentationRevision: revision,
          };
        },
        async commit(input) {
          calls.push(['presentation.commit', input]);
          previousProfile = profile;
          if (input.intent.defaultVoiceReference !== undefined) {
            defaultVoiceReference = input.intent.defaultVoiceReference;
          }
          if (input.intent.avatarAutoplay !== undefined) {
            avatarAutoplay = input.intent.avatarAutoplay;
          }
          revision = String(BigInt(revision) + 1n);
          profile = {
            backendKind: null,
            avatarAssetRef: input.intent.avatarAssetRef ?? profile?.avatarAssetRef ?? '',
            expressionProfileRef: input.intent.expressionProfileRef ?? profile?.expressionProfileRef ?? '',
            idlePreset: input.intent.idlePreset ?? profile?.idlePreset ?? '',
            interactionPolicyRef: input.intent.interactionPolicyRef ?? profile?.interactionPolicyRef ?? '',
            defaultVoiceReference,
            avatarAutoplay,
            backgroundAssetRef: input.intent.backgroundAssetRef ?? profile?.backgroundAssetRef ?? '',
            revision,
          };
          return {
            profile,
            previousProfile,
            defaultVoiceReference,
            avatarAutoplay,
            presentationRevision: revision,
          };
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });
    await session.refresh();

    expect(session.getSnapshot().availability.replaceAppearance).toMatchObject({ state: 'available' });
    expect(session.appearance.setDefaultVoice).toBeTypeOf('function');
    expect(session.appearance.setAvatarAutoplay).toBeTypeOf('function');
    expect(session.appearance.replaceAvatar).toBeUndefined();

    await session.appearance.setDefaultVoice?.('preset_voice_id:serena');
    await session.appearance.setAvatarAutoplay?.(true);
    expect(calls).toContainEqual(['presentation.commit', {
      agentHandle: HANDLE,
      expectedPresentationRevision: '0',
      intent: { defaultVoiceReference: 'preset_voice_id:serena' },
      importedAssets: [],
    }]);
    expect(calls).toContainEqual(['presentation.commit', {
      agentHandle: HANDLE,
      expectedPresentationRevision: '1',
      intent: { avatarAutoplay: true },
      importedAssets: [],
    }]);
    expect(session.getSnapshot().state.appearance).toMatchObject({
      status: 'not_configured',
      backendKind: null,
      avatarAssetRef: null,
      defaultVoiceReference: 'preset_voice_id:serena',
      avatarAutoplay: true,
    });
    expect(session.getSnapshot().availability.restorePreviousAppearance).toMatchObject({ state: 'available' });

    await session.restorePreviousAppearance();
    expect(calls).toContainEqual(['presentation.commit', {
      agentHandle: HANDLE,
      expectedPresentationRevision: '2',
      intent: {
        avatarAssetRef: '',
        expressionProfileRef: '',
        idlePreset: '',
        interactionPolicyRef: '',
        defaultVoiceReference: 'preset_voice_id:serena',
        avatarAutoplay: false,
        backgroundAssetRef: '',
      },
      importedAssets: [],
    }]);
    expect(session.getSnapshot().state.appearance).toMatchObject({
      status: 'not_configured',
      backendKind: null,
      defaultVoiceReference: 'preset_voice_id:serena',
      avatarAutoplay: false,
    });
  });

  it('preserves typed owner rejection instead of reporting every App read failure as offline', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      sharedAIConfig: {
        ...base.sharedAIConfig,
        async get() {
          throw Object.assign(new Error('covered operation rejected'), {
            reasonCode: 'LOCAL_APP_ACCESS_DENIED',
          });
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });

    await session.refresh();

    expect(session.getSnapshot()).toMatchObject({
      phase: 'degraded',
      availability: {
        getSharedAIConfig: {
          state: 'unavailable',
          reason: 'owner-rejected',
          nextStep: 'openRuntimeSettings',
        },
      },
    });
  });

  it('passes typed autonomy values to the SDK client without Kit enum or numeric validation', async () => {
    const calls: unknown[] = [];
    const session = createAppAgentCenterSession({ handle: HANDLE, client: appClient(calls) });
    await session.refresh();
    await session.updateAutonomy({
      expectedRevision: '1',
      enabled: true,
      mode: 'medium',
      dailyTokenBudget: 2048,
      maxTokensPerHook: 256,
    });
    expect(calls).toContainEqual([
      'autonomy.update',
      {
        agentHandle: HANDLE,
        expectedAutonomyRevision: '1',
        intent: {
          enabled: true,
          config: { mode: 'medium', dailyTokenBudget: 2048, maxTokensPerHook: 256 },
        },
      },
    ]);
  });

  it('commits App autonomy from the canonical mutation response without unrelated follow-up reads', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    let rejectSharedReads = false;
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      sharedAIConfig: {
        ...base.sharedAIConfig,
        async get() {
          if (rejectSharedReads) throw new Error('follow-up shared read failed');
          return base.sharedAIConfig.get();
        },
      },
      autonomy: {
        ...base.autonomy,
        async update(input) {
          const projection = await base.autonomy.update(input);
          rejectSharedReads = true;
          return projection;
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });
    await session.refresh();
    await session.updateAutonomy({
      expectedRevision: '1',
      enabled: true,
      mode: 'medium',
      dailyTokenBudget: 2048,
      maxTokensPerHook: 256,
    });

    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      error: null,
      state: {
        autonomyRevision: '2',
        autonomy: { revision: '2', mode: 'medium', dailyTokenBudget: 2048 },
      },
    });
  });

  it('patches presentation through the same nominal handle without replacing other profile fields', async () => {
    const calls: unknown[] = [];
    const session = createAppAgentCenterSession({ handle: HANDLE, client: appClient(calls) });
    await session.refresh();
    await session.appearance.setAvatarAutoplay?.(true);
    expect(calls).toContainEqual(['presentation.commit', {
      agentHandle: HANDLE,
      expectedPresentationRevision: '1',
      intent: { avatarAutoplay: true },
      importedAssets: [],
    }]);
  });

  it('preserves nullable presentation clear intent instead of restoring the current field', async () => {
    const calls: unknown[] = [];
    const session = createAppAgentCenterSession({ handle: HANDLE, client: appClient(calls) });
    await session.refresh();

    await session.replaceAppearance({
      expectedRevision: '1',
      intent: {
        avatarAssetReference: null,
        defaultVoiceReference: null,
        backgroundAssetReference: null,
      },
      importedAssets: [],
    });

    expect(calls).toContainEqual([
      'presentation.commit',
      expect.objectContaining({
        intent: expect.objectContaining({
          avatarAssetRef: '',
          defaultVoiceReference: '',
          backgroundAssetRef: '',
        }),
      }),
    ]);
  });

  it('passes the optional conversation anchor only to the canonical Manager snapshot read', async () => {
    const calls: unknown[] = [];
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      conversationAnchorId: 'anchor-current',
      client: appClient(calls),
    });
    await session.refresh();
    expect(calls).toContainEqual(['manager.snapshot', {
      agentHandle: HANDLE,
      conversationAnchorId: 'anchor-current',
    }]);
    expect(JSON.stringify(calls)).not.toMatch(/ownerUserId|runtimeSourceRef|localAgentRef/u);
  });

  it('keeps Host selection and preview mechanical while the canonical App client owns the presentation commit', async () => {
    const calls: unknown[] = [];
    const hostCalls: unknown[] = [];
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: appClient(calls),
      hostMechanics: {
        async selectAvatar(kind) {
          hostCalls.push(['selectAvatar', kind]);
          return {
            intent: { backendKind: kind, avatarAssetReference: 'asset://avatar/selected' },
            importedAssets: [{
              role: 'avatar', fileName: 'selected.vrm', mediaType: 'model/gltf-binary',
              content: new Uint8Array([1, 2, 3]), sha256: 'abc123',
            }],
          };
        },
        async resolveCommittedPreview(input) {
          hostCalls.push(['preview', input]);
          return {
            state: 'ready', tier: 'avatar_preview_service',
            previewImageRef: '/__nimi/avatar-preview/committed.png',
            visiblePixels: 42, nonPlaceholder: true, warnings: [],
          };
        },
      },
    });
    await session.refresh();
    await session.appearance.replaceAvatar?.('vrm');
    expect(hostCalls[0]).toEqual(['selectAvatar', 'vrm']);
    expect(hostCalls.at(-1)).toEqual(['preview', {
      backendKind: 'vrm',
      avatarAssetRef: 'asset://avatar/selected',
      presentationRevision: '2',
    }]);
    expect(JSON.stringify(hostCalls)).not.toMatch(/agentHandle|ownerUserId|runtimeSourceRef|localAgentRef/u);
    expect(calls).toContainEqual(['presentation.commit', expect.objectContaining({
      agentHandle: HANDLE,
      expectedPresentationRevision: '1',
      intent: expect.objectContaining({
        backendKind: 'vrm',
        avatarAssetRef: 'asset://avatar/selected',
      }),
    })]);
    expect(session.getSnapshot().state.appearance).toMatchObject({
      renderState: 'ready',
      renderTier: 'avatar_preview_service',
      renderImageRef: '/__nimi/avatar-preview/committed.png',
      renderVisiblePixels: 42,
    });
  });

  it('invalidates permanently and fences a late Manager read from replacing the degraded snapshot', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      manager: {
        async snapshot(input) {
          await blocked;
          return base.manager.snapshot(input);
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });
    const refresh = session.refresh();
    session.invalidate();
    release?.();
    await refresh;
    expect(session.getSnapshot()).toMatchObject({
      phase: 'degraded',
      availability: { updateAutonomy: { state: 'unavailable', reason: 'owner-rejected' } },
    });
    const updatesBefore = calls.filter((call) => Array.isArray(call) && call[0] === 'autonomy.update').length;
    await expect(session.updateAutonomy({
      expectedRevision: '1', enabled: true, mode: 'low', dailyTokenBudget: 10, maxTokensPerHook: 1,
    })).rejects.toThrow(/invalidated/u);
    expect(calls.filter((call) => Array.isArray(call) && call[0] === 'autonomy.update')).toHaveLength(updatesBefore);
  });

  it('degrades the affected availability when a typed mutation fails', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      autonomy: {
        ...base.autonomy,
        async update() {
          throw Object.assign(new Error('owner changed'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' });
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });
    await session.refresh();
    await expect(session.updateAutonomy({
      expectedRevision: '1', enabled: true, mode: 'low', dailyTokenBudget: 10, maxTokensPerHook: 1,
    })).rejects.toThrow('owner changed');
    expect(session.getSnapshot()).toMatchObject({
      phase: 'degraded',
      availability: { updateAutonomy: { state: 'unavailable', reason: 'owner-rejected' } },
      error: 'owner changed',
    });
  });

  it('keeps the Manager Session nominal and rejects a plain string handle at compile time', () => {
    const client = appClient([]);
    // @ts-expect-error Agent Center consumes the SDK nominal handle, not a second Kit brand or plain string.
    createAppAgentCenterSession({ handle: 'agent_ref_plain', client });
    // @ts-expect-error Manager Sessions are nominal factory outputs, not structural caller state.
    const fabricated: AgentCenterSession = {
      getSnapshot() {
        throw new Error('fabricated');
      },
      subscribe() {
        return () => undefined;
      },
      async refresh() {},
      async overwriteSharedAIConfig() {
        return {
          outcome: 'committed' as const,
          config: sharedConfig(),
          revision: '1',
          participation: PARTICIPATION,
        };
      },
      async listSharedAIConfigOptions() {
        return { kind: 'local-loadouts' as const, options: [], truncated: false };
      },
      async updateAutonomy() {},
      async replaceAppearance() {},
      async restorePreviousAppearance() {},
      appearance: {},
    };
    expect(fabricated).toBeTruthy();
  });
});
