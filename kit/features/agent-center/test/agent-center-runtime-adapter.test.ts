import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  NimiCapabilityAIConfig,
  NimiAIConfigEffectiveSelection,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationProfile,
  NimiSharedLocalAgentAIConfigSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import { createAppAgentCenterSession } from '../src/session.js';
import type { AgentCenterAppearanceAdapter, AgentCenterSharedAIConfigProjection, AgentCenterSession } from '../src/types.js';
import { testManagerActionAvailability } from './session-fixture.js';
import { TestResourcePackTargetController } from './resource-pack-target-fixture.js';

const HANDLE = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
] as const;

type RetiredAppearanceShadowMethod =
  | 'linkLive2dAdapterManifest'
  | 'clearAvatarAsset'
  | 'clearBackground'
  | 'removeAgentResources'
  | 'cleanupGeneratedVoiceArtifacts';

it('keeps retired appearance shadows out of the public Agent Center surface', () => {
  expectTypeOf<Extract<keyof AgentCenterAppearanceAdapter, RetiredAppearanceShadowMethod>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof AgentCenterSession['appearance'], RetiredAppearanceShadowMethod>>().toEqualTypeOf<never>();
});

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
  let resourcePackSelection: {
    readonly assetRef: string;
    readonly targetId: 'zhiyu-experience-surface';
    readonly targetVersion: 1;
  } | null = null;
  let resourcePackAsset: {
    readonly fileName: string;
    readonly content: Uint8Array;
    readonly sha256: string;
  } | null = null;
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
        if (query.kind === 'voice-assets') {
          return { kind: 'voice-assets', truncated: false, options: [] };
        }
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
          resourcePackSelection,
        };
      },
      async readAsset(input) {
        calls.push(['presentation.readAsset', input]);
        if (resourcePackSelection?.assetRef === input.assetRef && resourcePackAsset) {
          return {
            assetRef: input.assetRef,
            role: 'resource-pack',
            fileName: resourcePackAsset.fileName,
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from(resourcePackAsset.content),
            sha256: resourcePackAsset.sha256,
          };
        }
        return {
          assetRef: input.assetRef,
          role: 'avatar',
          backendKind: 'sprite2d',
          fileName: 'avatar.png',
          mediaType: 'image/png',
          content: new Uint8Array([1, 2, 3]),
          sha256: 'a'.repeat(64),
        };
      },
      async commit(input) {
        calls.push(['presentation.commit', input]);
        presentationRevision = String(BigInt(presentationRevision) + 1n);
        if ('selectImportedResourcePack' in input.intent) {
          const material = input.importedAssets[0];
          if (!material || material.role !== 'resource-pack') throw new Error('Resource Pack material required.');
          resourcePackAsset = {
            fileName: material.fileName,
            content: Uint8Array.from(material.content),
            sha256: material.sha256,
          };
          resourcePackSelection = {
            assetRef: `pack_${material.sha256.slice(0, 12)}`,
            targetId: 'zhiyu-experience-surface',
            targetVersion: 1,
          };
          return this.snapshot({ agentHandle: input.agentHandle });
        }
        if ('clearResourcePackSelection' in input.intent) {
          resourcePackSelection = null;
          resourcePackAsset = null;
          return this.snapshot({ agentHandle: input.agentHandle });
        }
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
          resourcePackSelection,
        };
      },
    },
    memory: {
      async inspect(input) {
        calls.push(['memory.inspect', input]);
        return {
          outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
          currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
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
          actionAvailability: testManagerActionAvailability(),
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
      sourceLabel: 'Shared LocalAgent preset voices + LocalApp custom VoiceAssets',
      options: [{ reference: 'preset_voice_id:serena', kind: 'preset_voice_id', name: 'Serena' }],
      sources: {
        preset: { state: 'ready', reason: null },
        custom: { state: 'ready', reason: null },
      },
    });
    expect(calls).toContainEqual(['shared.listOptions', { kind: 'preset-voices' }]);
    expect(calls).toContainEqual(['shared.listOptions', { kind: 'voice-assets' }]);
    expect(calls).toContainEqual(['autonomy.snapshot', { agentHandle: HANDLE }]);
    expect(calls).toContainEqual(['presentation.snapshot', { agentHandle: HANDLE }]);
    expect(calls).toContainEqual(['memory.inspect', { agentHandle: HANDLE, limit: 100 }]);
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

  it('merges preset voices with bounded canonical VoiceAsset options from the same manager client', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: {
        ...base,
        sharedAIConfig: {
          ...base.sharedAIConfig,
          async listOptions(query) {
            if (query.kind === 'voice-assets') {
              return {
                kind: 'voice-assets',
                options: Array.from({ length: 100 }, (_, index) => ({ voiceAssetId: `custom-${index}` })),
                truncated: true,
              };
            }
            return base.sharedAIConfig.listOptions(query);
          },
        },
      },
    });
    await session.refresh();

    const catalog = session.getSnapshot().state.appearance.voiceCatalog;
    expect(catalog).toMatchObject({
      state: 'ready',
      truncated: true,
      sources: {
        preset: { state: 'ready', reason: null },
        custom: { state: 'ready', reason: null },
      },
    });
    expect(catalog?.options.filter((option) => option.kind === 'preset_voice_id')).toHaveLength(1);
    expect(catalog?.options.filter((option) => option.kind === 'voice_asset_id')).toHaveLength(100);
    expect(catalog?.options.some((option) => option.reference === 'voice_asset_id:custom-0')).toBe(true);
  });

  it('keeps custom VoiceAssets available when the preset catalog alone fails', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: {
        ...base,
        sharedAIConfig: {
          ...base.sharedAIConfig,
          async listOptions(query) {
            if (query.kind === 'preset-voices') {
              throw Object.assign(new Error('preset owner unavailable'), { reasonCode: 'RUNTIME_UNAVAILABLE' });
            }
            if (query.kind === 'voice-assets') {
              return { kind: 'voice-assets', options: [{ voiceAssetId: 'custom-ready' }], truncated: false };
            }
            return base.sharedAIConfig.listOptions(query);
          },
        },
      },
    });
    await session.refresh();

    expect(session.getSnapshot().phase).toBe('ready');
    expect(session.getSnapshot().state.appearance.voiceCatalog).toMatchObject({
      state: 'ready',
      options: [{ reference: 'voice_asset_id:custom-ready', kind: 'voice_asset_id' }],
      sources: {
        preset: { state: 'unavailable', reason: 'runtime-offline', message: 'preset owner unavailable' },
        custom: { state: 'ready', reason: null },
      },
    });
  });

  it('loads bounded Memory pages by opaque token and retains a 200-item renderer window', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const page = (start: number, count: number, nextPageToken: string | null) => ({
      outcome: 'ready' as const,
      enabled: true,
      adoptionRequired: false,
      items: Array.from({ length: count }, (_, index) => ({
        memoryId: `memory-${start + index}`,
        content: `bounded ${start + index}`,
        epistemicStatus: 'explicit' as const,
        lifecycle: 'current' as const,
        occurredAt: '2026-08-27T10:00:00Z',
        updatedAt: '2026-08-27T10:00:00Z',
        sourceExplanation: 'Committed user message',
      })),
      currentCount: 300,
      supersededCount: 0,
      forgottenCount: 0,
      nextPageToken,
    });
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      memory: {
        ...base.memory,
        async inspect(input) {
          calls.push(['paged-memory.inspect', input]);
          if (input.pageToken === 'page-2') return page(90, 100, 'page-3');
          if (input.pageToken === 'page-3') return page(190, 100, null);
          return page(0, 100, 'page-2');
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });

    await session.refresh();
    expect(calls).toContainEqual(['paged-memory.inspect', { agentHandle: HANDLE, limit: 100 }]);
    expect(session.getSnapshot().state.cognition.memory?.items).toHaveLength(100);

    await session.loadMoreMemory();
    expect(calls).toContainEqual(['paged-memory.inspect', {
      agentHandle: HANDLE, limit: 100, pageToken: 'page-2',
    }]);
    expect(session.getSnapshot().state.cognition.memory?.items).toHaveLength(190);

    const finalPage = await session.loadMoreMemory();
    expect(calls).toContainEqual(['paged-memory.inspect', {
      agentHandle: HANDLE, limit: 100, pageToken: 'page-3',
    }]);
    expect(finalPage.items).toHaveLength(200);
    expect(new Set(finalPage.items.map((item) => item.memoryId)).size).toBe(200);
    expect(finalPage.items[0]?.memoryId).toBe('memory-90');
    expect(finalPage.items.at(-1)?.memoryId).toBe('memory-289');
    expect(finalPage.nextPageToken).toBeNull();
  });

  it('does not adopt a late Memory page after a full owner refresh', async () => {
    const base = appClient([]);
    let refreshCount = 0;
    const memoryPage = (memoryId: string, nextPageToken: string | null) => ({
      outcome: 'ready' as const,
      enabled: true,
      adoptionRequired: false,
      items: [{
        memoryId,
        content: memoryId,
        epistemicStatus: 'explicit' as const,
        lifecycle: 'current' as const,
        occurredAt: '2026-08-27T10:00:00Z',
        updatedAt: '2026-08-27T10:00:00Z',
        sourceExplanation: 'Committed user message',
      }],
      currentCount: 1,
      supersededCount: 0,
      forgottenCount: 0,
      nextPageToken,
    });
    let releasePage: ((value: ReturnType<typeof memoryPage>) => void) | undefined;
    let pageStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { pageStarted = resolve; });
    const blockedPage = new Promise<ReturnType<typeof memoryPage>>((resolve) => { releasePage = resolve; });
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      memory: {
        ...base.memory,
        async inspect(input) {
          if (input.pageToken === 'page-2') {
            pageStarted?.();
            return blockedPage;
          }
          refreshCount += 1;
          return refreshCount === 1
            ? memoryPage('memory-initial', 'page-2')
            : memoryPage('memory-refreshed', null);
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });
    await session.refresh();

    const latePage = session.loadMoreMemory();
    await started;
    await session.refresh();
    releasePage?.(memoryPage('memory-late', null));
    await latePage;

    expect(session.getSnapshot().state.cognition.memory?.items.map((item) => item.memoryId)).toEqual([
      'memory-refreshed',
    ]);
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
        ...base.presentation,
        async snapshot(input) {
          calls.push(['presentation.snapshot', input]);
          return {
            profile,
            previousProfile,
            defaultVoiceReference,
            avatarAutoplay,
            presentationRevision: revision,
            resourcePackSelection: null,
          };
        },
        async commit(input) {
          calls.push(['presentation.commit', input]);
          if ('selectImportedResourcePack' in input.intent || 'clearResourcePackSelection' in input.intent) {
            throw new Error('Resource Pack mutation is not used by this fixture.');
          }
          const intent = input.intent;
          previousProfile = profile;
          if (intent.defaultVoiceReference !== undefined) {
            defaultVoiceReference = intent.defaultVoiceReference;
          }
          if (intent.avatarAutoplay !== undefined) {
            avatarAutoplay = intent.avatarAutoplay;
          }
          revision = String(BigInt(revision) + 1n);
          profile = {
            backendKind: null,
            avatarAssetRef: intent.avatarAssetRef ?? profile?.avatarAssetRef ?? '',
            expressionProfileRef: intent.expressionProfileRef ?? profile?.expressionProfileRef ?? '',
            idlePreset: intent.idlePreset ?? profile?.idlePreset ?? '',
            interactionPolicyRef: intent.interactionPolicyRef ?? profile?.interactionPolicyRef ?? '',
            defaultVoiceReference,
            avatarAutoplay,
            backgroundAssetRef: intent.backgroundAssetRef ?? profile?.backgroundAssetRef ?? '',
            revision,
          };
          return {
            profile,
            previousProfile,
            defaultVoiceReference,
            avatarAutoplay,
            presentationRevision: revision,
            resourcePackSelection: null,
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

  it('owns exact reviewed Resource Pack bytes through CAS Apply, committed read, Retry, and selection-only Clear', async () => {
    const calls: unknown[] = [];
    const sourceBytes = Uint8Array.from([7, 8, 9]);
    const controller = new TestResourcePackTargetController();
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: appClient(calls),
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'technical-pack-a.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: sourceBytes,
            sha256: 'c'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();

    await session.appearance.selectResourcePack?.();
    expect(session.getSnapshot().state.appearance.resourcePackTarget).toMatchObject({
      phase: 'preview',
      reviewFileName: 'technical-pack-a.nimipack',
    });
    expect(Object.keys(session.getSnapshot().state.appearance.resourcePackTarget ?? {}).sort()).toEqual([
      'effectiveResourceRef', 'error', 'mismatchReason', 'pendingTruth', 'phase', 'reviewFileName',
    ]);
    expect(JSON.stringify(session.getSnapshot().state.appearance.resourcePackTarget)).not.toMatch(/archiveBytes|content|scopedCssText/u);
    sourceBytes[0] = 255;
    controller.renderFailure = new Error('selected render failed');
    await session.appearance.applyResourcePack?.();

    const apply = calls.find((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { selectImportedResourcePack?: boolean } }).intent?.selectImportedResourcePack) as [string, {
        expectedPresentationRevision: string;
        importedAssets: readonly [{ readonly content: Uint8Array }];
      }];
    expect(apply[1].expectedPresentationRevision).toBe('1');
    expect(apply[1].importedAssets[0].content).toEqual(Uint8Array.from([7, 8, 9]));
    expect(session.getSnapshot().state.appearance).toMatchObject({
      resourcePackSelection: {
        assetRef: `pack_${'c'.repeat(12)}`,
        targetId: 'zhiyu-experience-surface',
        targetVersion: 1,
      },
      resourcePackTarget: {
        phase: 'fallback',
        mismatchReason: 'selected render failed',
      },
    });
    expect(calls).toContainEqual(['presentation.readAsset', {
      agentHandle: HANDLE,
      assetRef: `pack_${'c'.repeat(12)}`,
    }]);

    controller.renderFailure = null;
    await session.appearance.retryResourcePack?.();
    expect(session.getSnapshot().state.appearance.resourcePackTarget).toMatchObject({
      phase: 'selected',
      effectiveResourceRef: `pack_${'c'.repeat(12)}`,
    });

    await session.appearance.clearResourcePack();
    const clear = calls.find((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { clearResourcePackSelection?: boolean } }).intent?.clearResourcePackSelection) as [string, {
        importedAssets: readonly unknown[];
      }];
    expect(clear[1].importedAssets).toEqual([]);
    expect(session.getSnapshot().state.appearance).toMatchObject({
      resourcePackSelection: null,
      resourcePackTarget: { phase: 'default' },
    });
    expect(calls.filter((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { selectImportedResourcePack?: boolean } }).intent?.selectImportedResourcePack)).toHaveLength(1);
  });

  it('reconciles an ambiguous Apply as committed only after rereading the exact selected digest', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        ...base.presentation,
        async commit(input) {
          const projection = await base.presentation.commit(input);
          if ('selectImportedResourcePack' in input.intent) {
            throw new Error('transport closed after Apply');
          }
          return projection;
        },
      },
    };
    const controller = new TestResourcePackTargetController();
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client,
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'reconciled.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([4, 5, 6]),
            sha256: 'e'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();
    await session.appearance.selectResourcePack?.();
    await session.appearance.applyResourcePack?.();

    expect(session.getSnapshot().state.appearance).toMatchObject({
      resourcePackSelection: { assetRef: `pack_${'e'.repeat(12)}` },
      resourcePackTarget: { phase: 'selected', effectiveResourceRef: `pack_${'e'.repeat(12)}` },
    });
    expect(calls.filter((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { selectImportedResourcePack?: boolean } }).intent?.selectImportedResourcePack)).toHaveLength(1);
  });

  it('preserves canonical truth and surfaces a conflict when Apply selects different bytes', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        ...base.presentation,
        async commit(input) {
          const projection = await base.presentation.commit(input);
          if ('selectImportedResourcePack' in input.intent) {
            throw new Error('transport closed after Resource Pack Apply');
          }
          return projection;
        },
        async readAsset(input) {
          const asset = await base.presentation.readAsset(input);
          return asset.role === 'resource-pack'
            ? { ...asset, sha256: 'f'.repeat(64) }
            : asset;
        },
      },
    };
    const controller = new TestResourcePackTargetController();
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client,
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'reviewed.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([7, 8, 9]),
            sha256: 'c'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();
    await session.appearance.selectResourcePack?.();
    await expect(session.appearance.applyResourcePack?.()).rejects.toThrow(/exact reviewed bytes/u);

    expect(session.getSnapshot().state.appearance.resourcePackSelection).toMatchObject({
      assetRef: `pack_${'c'.repeat(12)}`,
    });
    expect(calls.filter((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { selectImportedResourcePack?: boolean } }).intent?.selectImportedResourcePack)).toHaveLength(1);
  });

  it('keeps an unreadable Apply outcome pending until authoritative refresh', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    let rejectSnapshots = false;
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        ...base.presentation,
        async snapshot(input) {
          if (rejectSnapshots) throw new Error('Runtime reread unavailable');
          return base.presentation.snapshot(input);
        },
        async commit(input) {
          if ('selectImportedResourcePack' in input.intent) {
            calls.push(['presentation.commit', input]);
            rejectSnapshots = true;
            throw new Error('Apply transport outcome unknown');
          }
          return base.presentation.commit(input);
        },
      },
    };
    const controller = new TestResourcePackTargetController();
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client,
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'pending.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([1, 2, 3]),
            sha256: 'd'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();
    await session.appearance.selectResourcePack?.();
    await session.appearance.applyResourcePack?.();

    expect(session.getSnapshot()).toMatchObject({
      phase: 'degraded',
      state: { appearance: { resourcePackTarget: {
        phase: 'apply-in-flight',
        pendingTruth: 'apply-outcome-unknown',
      } } },
    });
    expect(session.getSnapshot().error).toMatch(/pending reconciliation/u);
    expect(controller.calls.some((entry) => Array.isArray(entry) && entry[0] === 'applyFailed')).toBe(false);
    expect(controller.calls).toContainEqual([
      'mutationOutcomeUnknown',
      'apply',
      expect.stringMatching(/pending reconciliation/u),
    ]);

    rejectSnapshots = false;
    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      state: { appearance: { resourcePackSelection: null, resourcePackTarget: { phase: 'default' } } },
    });
  });

  it('keeps an ambiguous Apply pending when canonical selection is readable but selected bytes are not', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        ...base.presentation,
        async commit(input) {
          const projection = await base.presentation.commit(input);
          if ('selectImportedResourcePack' in input.intent) {
            throw new Error('transport closed after Apply');
          }
          return projection;
        },
        async readAsset() {
          throw new Error('selected resource temporarily unreadable');
        },
      },
    };
    const controller = new TestResourcePackTargetController();
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client,
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'pending-read.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([1, 2, 3]),
            sha256: 'd'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();
    await session.appearance.selectResourcePack?.();
    await session.appearance.applyResourcePack?.();

    expect(session.getSnapshot()).toMatchObject({
      phase: 'degraded',
      state: { appearance: {
        resourcePackMutationPending: 'apply',
        resourcePackTarget: { pendingTruth: 'apply-outcome-unknown' },
      } },
    });
    session.appearance.cancelResourcePackPreview?.();
    expect(session.getSnapshot().state.appearance.resourcePackTarget).toMatchObject({
      pendingTruth: 'apply-outcome-unknown',
    });
    expect(controller.calls.some((entry) => Array.isArray(entry) && entry[0] === 'applyFailed')).toBe(false);
  });

  it('reconciles an ambiguous Clear without replay after Runtime already cleared selection', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        ...base.presentation,
        async commit(input) {
          const projection = await base.presentation.commit(input);
          if ('clearResourcePackSelection' in input.intent) {
            throw new Error('transport closed after Clear');
          }
          return projection;
        },
      },
    };
    const controller = new TestResourcePackTargetController();
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client,
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'clear-me.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([7, 8, 9]),
            sha256: 'c'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();
    await session.appearance.selectResourcePack?.();
    await session.appearance.applyResourcePack?.();
    await session.appearance.clearResourcePack();

    expect(session.getSnapshot().state.appearance).toMatchObject({
      resourcePackSelection: null,
      resourcePackTarget: { phase: 'default' },
    });
    expect(calls.filter((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { clearResourcePackSelection?: boolean } }).intent?.clearResourcePackSelection)).toHaveLength(1);
  });

  it('keeps the reread canonical selection when an ambiguous Clear did not commit', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        ...base.presentation,
        async commit(input) {
          if ('clearResourcePackSelection' in input.intent) {
            calls.push(['presentation.commit', input]);
            throw new Error('Clear transport outcome unknown');
          }
          return base.presentation.commit(input);
        },
      },
    };
    const controller = new TestResourcePackTargetController();
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client,
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'keep-me.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([7, 8, 9]),
            sha256: 'c'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();
    await session.appearance.selectResourcePack?.();
    await session.appearance.applyResourcePack?.();
    await expect(session.appearance.clearResourcePack()).rejects.toThrow(/canonical selection/u);

    expect(session.getSnapshot().state.appearance.resourcePackSelection).toMatchObject({
      assetRef: `pack_${'c'.repeat(12)}`,
    });
    expect(calls.filter((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { clearResourcePackSelection?: boolean } }).intent?.clearResourcePackSelection)).toHaveLength(1);
  });

  it('rejects a late Resource Pack preview after the presentation revision changes', async () => {
    const calls: unknown[] = [];
    const controller = new TestResourcePackTargetController();
    let releasePreview: (() => void) | undefined;
    controller.beginPreviewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: appClient(calls),
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'stale.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([1, 2, 3]),
            sha256: 'd'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();

    const preview = session.appearance.selectResourcePack!();
    while (!controller.calls.some((entry) => Array.isArray(entry) && entry[0] === 'beginPreview')) {
      await Promise.resolve();
    }
    await session.appearance.setAvatarAutoplay?.(true);
    releasePreview?.();
    await expect(preview).rejects.toThrow(/stale/u);
    expect(session.getSnapshot().state.appearance).toMatchObject({
      presentationRevision: '2',
      resourcePackSelection: null,
      resourcePackTarget: { phase: 'default' },
    });
    expect(calls.some((entry) => Array.isArray(entry)
      && entry[0] === 'presentation.commit'
      && (entry[1] as { intent?: { selectImportedResourcePack?: boolean } }).intent?.selectImportedResourcePack)).toBe(false);
  });

  it('cancels a pending Resource Pack preview without allowing late review resurrection', async () => {
    const calls: unknown[] = [];
    const controller = new TestResourcePackTargetController();
    let releasePreview: (() => void) | undefined;
    controller.beginPreviewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: appClient(calls),
      hostMechanics: {
        async selectResourcePack() {
          return {
            role: 'resource-pack',
            fileName: 'pending-preview.nimipack',
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([1, 2, 3]),
            sha256: 'd'.repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();

    const preview = session.appearance.selectResourcePack!();
    while (!controller.calls.some((entry) => Array.isArray(entry) && entry[0] === 'beginPreview')) {
      await Promise.resolve();
    }
    session.appearance.cancelResourcePackPreview?.();
    releasePreview?.();
    await expect(preview).rejects.toThrow(/stale/u);
    expect(session.getSnapshot().state.appearance.resourcePackTarget).toMatchObject({ phase: 'default' });
  });

  it('keeps the newer Resource Pack preview when an older file selection resolves late', async () => {
    const calls: unknown[] = [];
    const controller = new TestResourcePackTargetController();
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let selectionCount = 0;
    const session = createAppAgentCenterSession({
      handle: HANDLE,
      client: appClient(calls),
      hostMechanics: {
        async selectResourcePack() {
          selectionCount += 1;
          const current = selectionCount;
          if (current === 1) await firstGate;
          return {
            role: 'resource-pack',
            fileName: `candidate-${current}.nimipack`,
            mediaType: 'application/vnd.nimi.resource-pack+zip',
            content: Uint8Array.from([current]),
            sha256: (current === 1 ? 'c' : 'd').repeat(64),
          };
        },
      },
      resourcePackTargetController: controller,
    });
    await session.refresh();

    const first = session.appearance.selectResourcePack!();
    while (selectionCount !== 1) await Promise.resolve();
    await session.appearance.selectResourcePack!();
    releaseFirst?.();
    await expect(first).rejects.toThrow(/stale/u);
    expect(session.getSnapshot().state.appearance.resourcePackTarget).toMatchObject({
      phase: 'preview',
      reviewFileName: 'candidate-2.nimipack',
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

  it('keeps healthy sections and actions available when Memory inspect alone is unavailable', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      memory: {
        ...base.memory,
        async inspect() {
          throw Object.assign(new Error('Memory owner is unavailable'), {
            reasonCode: 'RUNTIME_UNAVAILABLE',
          });
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });

    await session.refresh();

    expect(session.getSnapshot()).toMatchObject({
      phase: 'degraded',
      state: {
        sharedAIConfig: { revision: '1' },
        autonomy: { revision: '1', enabled: true },
        appearance: { presentationRevision: '1', avatarAssetRef: 'avatar-1' },
        cognition: { lifecycleStatus: 'active', memory: null },
      },
      availability: {
        getSharedAIConfig: { state: 'available' },
        updateAutonomy: { state: 'available' },
        replaceAppearance: { state: 'available' },
        inspectMemory: { state: 'unavailable', reason: 'runtime-offline' },
        correctMemory: { state: 'unavailable', reason: 'runtime-offline' },
        forgetMemory: { state: 'unavailable', reason: 'runtime-offline' },
        switchMemory: { state: 'unavailable', reason: 'runtime-offline' },
        deleteAllMemory: { state: 'unavailable', reason: 'runtime-offline' },
      },
    });
  });

  it('preserves complete bounded presentation metadata in the shared appearance projection', async () => {
    const base = appClient([]);
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      presentation: {
        ...base.presentation,
        async snapshot(input) {
          const projection = await base.presentation.snapshot(input);
          return {
            ...projection,
            profile: projection.profile ? {
              ...projection.profile,
              expressionProfileRef: 'expression:calm',
              idlePreset: 'idle:reading',
              interactionPolicyRef: 'interaction:companion',
            } : null,
          };
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });

    await session.refresh();

    expect(session.getSnapshot().state.appearance).toMatchObject({
      expressionProfileRef: 'expression:calm',
      idlePreset: 'idle:reading',
      interactionPolicyRef: 'interaction:companion',
    });
  });

  it('returns the committed Memory terminal result when a concurrent refresh finishes first', async () => {
    const calls: unknown[] = [];
    const base = appClient(calls);
    let releaseMutation: (() => void) | undefined;
    let mutationStarted: (() => void) | undefined;
    const mutationBlocked = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const started = new Promise<void>((resolve) => { mutationStarted = resolve; });
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      memory: {
        ...base.memory,
        async inspect() {
          return {
            outcome: 'ready', enabled: true, adoptionRequired: false,
            items: [{
              memoryId: 'memory-1', content: 'unchanged', epistemicStatus: 'explicit', lifecycle: 'current',
              occurredAt: '2026-08-27T10:00:00Z', updatedAt: '2026-08-27T10:00:00Z',
              sourceExplanation: 'Committed user message',
            }],
            currentCount: 1, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
          };
        },
        async correct(input) {
          mutationStarted?.();
          await mutationBlocked;
          return {
            outcome: 'no_effect',
            affectedMemoryIds: [input.memoryId],
            projection: {
              outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
              currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
            },
          };
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });
    await session.refresh();

    const mutation = session.correctMemory({ memoryId: 'memory-1', correctedContent: 'unchanged' });
    await started;
    await session.refresh();
    releaseMutation?.();

    await expect(mutation).resolves.toEqual({
      outcome: 'no_effect',
      affectedMemoryIds: ['memory-1'],
      projection: {
        outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
        currentCount: 0, supersededCount: 0, forgottenCount: 0, nextPageToken: null,
      },
    });
  });

  it('does not let a refresh started before a committed mutation overwrite the mutation projection', async () => {
    const base = appClient([]);
    const staleProjection = {
      outcome: 'ready' as const,
      enabled: true,
      adoptionRequired: false,
      items: [{
        memoryId: 'memory-1', content: 'before', epistemicStatus: 'explicit' as const,
        lifecycle: 'current' as const, occurredAt: '2026-08-27T10:00:00Z',
        updatedAt: '2026-08-27T10:00:00Z', sourceExplanation: 'Committed user message',
      }],
      currentCount: 1,
      supersededCount: 0,
      forgottenCount: 0,
      nextPageToken: null,
    };
    let inspectCount = 0;
    let committedProjection = staleProjection;
    let releaseRefresh: (() => void) | undefined;
    let refreshStarted: (() => void) | undefined;
    const refreshBlocked = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
    const client: NimiLocalAppAgentConfigureClient = {
      ...base,
      memory: {
        ...base.memory,
        async inspect() {
          inspectCount += 1;
          if (inspectCount === 2) {
            const captured = staleProjection;
            refreshStarted?.();
            await refreshBlocked;
            return captured;
          }
          return committedProjection;
        },
        async correct(input) {
          committedProjection = {
            ...staleProjection,
            items: staleProjection.items.map((item) => ({
              ...item,
              content: input.correctedContent,
              updatedAt: '2026-08-27T10:01:00Z',
            })),
          };
          return {
            outcome: 'committed',
            affectedMemoryIds: [input.memoryId],
            projection: committedProjection,
          };
        },
      },
    };
    const session = createAppAgentCenterSession({ handle: HANDLE, client });
    await session.refresh();

    const refresh = session.refresh();
    await started;
    await session.correctMemory({ memoryId: 'memory-1', correctedContent: 'after' });
    releaseRefresh?.();
    await refresh;

    expect(session.getSnapshot().state.cognition.memory?.items[0]?.content).toBe('after');
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
      appearance: { clearResourcePack: async () => undefined },
    };
    expect(fabricated).toBeTruthy();
  });
});
