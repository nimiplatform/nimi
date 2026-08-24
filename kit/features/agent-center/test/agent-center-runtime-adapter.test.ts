import { describe, expect, it } from 'vitest';
import type {
  NimiCapabilityAIConfig,
  NimiAIConfigEffectiveSelection,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiSharedLocalAgentAIConfigSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import { createAppAgentCenterSession, createFirstPartyAgentCenterSession } from '../src/session.js';
import type { AgentCenterSharedAIConfigProjection, AgentCenterSession } from '../src/types.js';

const HANDLE = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
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
      async listOptions() {
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
          profile: {
            backendKind: 'sprite2d',
            avatarAssetRef: 'avatar-1',
            expressionProfileRef: '',
            idlePreset: '',
            interactionPolicyRef: '',
            defaultVoiceReference: 'voice-1',
            avatarAutoplay: false,
            backgroundAssetRef: '',
            revision: presentationRevision,
          },
          previousProfile: null,
          defaultVoiceReference: 'voice-1',
          presentationRevision,
        };
      },
      async commit(input) {
        calls.push(['presentation.commit', input]);
        presentationRevision = String(BigInt(presentationRevision) + 1n);
        return {
          profile: { ...input.intent, revision: presentationRevision },
          previousProfile: null,
          defaultVoiceReference: input.intent.defaultVoiceReference,
          presentationRevision,
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
    const session = createFirstPartyAgentCenterSession({
      identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
      sharedAIConfig: {
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
        async listOptions() {
          return { kind: 'local-loadouts' as const, options: [], truncated: false };
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
    const session = createFirstPartyAgentCenterSession({
      identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
      sharedAIConfig: {
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
        async listOptions() {
          return { kind: 'local-loadouts' as const, options: [], truncated: false };
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
    expect(calls).toContainEqual(['autonomy.snapshot', { agentHandle: HANDLE }]);
    expect(calls).toContainEqual(['presentation.snapshot', { agentHandle: HANDLE }]);
    expect(JSON.stringify(calls)).not.toMatch(/ownerUserId|runtimeSourceRef|localAgentRef/u);
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
    expect(calls).toContainEqual([
      'presentation.commit',
      expect.objectContaining({
        agentHandle: HANDLE,
        expectedPresentationRevision: '1',
        intent: expect.objectContaining({
          avatarAssetRef: 'avatar-1',
          defaultVoiceReference: 'voice-1',
          avatarAutoplay: true,
        }),
      }),
    ]);
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
