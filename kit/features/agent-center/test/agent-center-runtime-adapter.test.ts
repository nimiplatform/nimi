import { describe, expect, it } from 'vitest';
import {
  createFirstPartyAgentCenterSession,
  createPermissionedAgentCenterSession,
  projectAgentCenterActionAvailability,
  sealAgentCenterPermissionedSdkSurface,
} from '../src/session.js';
import type {
  AgentCenterAutonomyProjection,
  AgentCenterOpaqueHandle,
  AgentCenterPermissionedPresentationCommitInput,
  AgentCenterPermissionedSdkSurface,
  AgentCenterPermissionedSdkSurfaceInput,
  AgentCenterProductAction,
  AgentCenterSharedAIConfigProjection,
  AgentCenterSession,
  AgentCenterStateInput,
  AgentCenterTransportActionProjection,
  AgentCenterTransportActionReason,
} from '../src/types.js';

const ACTIONS: readonly AgentCenterProductAction[] = [
  'getSharedAIConfig', 'overwriteSharedAIConfig', 'readAutonomy', 'updateAutonomy',
  'readMemorySummary', 'replaceAppearance', 'restorePreviousAppearance',
  'requestPermission', 'openPermissionSettings',
];

function transportProjection(reason: AgentCenterTransportActionReason | null = null): AgentCenterTransportActionProjection {
  return Object.fromEntries(ACTIONS.map((action) => [action, {
    state: reason ? 'unavailable' : 'available', reason,
  }])) as AgentCenterTransportActionProjection;
}

function recoveryProjection(reason: AgentCenterTransportActionReason): AgentCenterTransportActionProjection {
  const recoveryAction = reason === 'not_granted' || reason === 'grant_denied' || reason === 'grant_revoked'
    ? 'requestPermission'
    : null;
  return Object.fromEntries(ACTIONS.map((action) => [action, action === recoveryAction
    ? { state: 'available', reason: null }
    : { state: 'unavailable', reason }])) as AgentCenterTransportActionProjection;
}

function emptyProjection(capabilities: AgentCenterSharedAIConfigProjection['aiConfig']['capabilities'] = [{
  capabilityContract: 'text.generate',
  route: { oneofKind: 'local' as const, local: {} },
  requiredFeatures: [] as string[],
}]): AgentCenterStateInput {
  return {
    sharedAIConfig: {
      aiConfig: {
        owner: {
          owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
        },
        capabilities,
      },
      capabilities: capabilities.map((intent) => intent.capabilityContract),
      intents: capabilities.map((intent) => ({
        capability: intent.capabilityContract,
        route: intent.route.oneofKind === 'local' ? 'local' : 'cloud',
        requiredFeatures: intent.requiredFeatures,
      })),
    },
    autonomy: {
      revision: 'autonomy:1', enabled: true, mode: 'low', budgetExhausted: false,
      usedTokensInWindow: 0, dailyTokenBudget: 100, maxTokensPerHook: 10,
      windowStartedAt: null, suspendedUntil: null,
    },
    appearance: { status: 'not_configured', presentationRevision: 'presentation:1' },
  };
}

function permissionedSurface(overrides: Partial<AgentCenterPermissionedSdkSurface> = {}): AgentCenterPermissionedSdkSurface {
  return sealAgentCenterPermissionedSdkSurface({
    async actionPosture() { return transportProjection(); },
    async read() { return emptyProjection(); },
    async overwriteSharedAIConfig(input) { return emptyProjection([...input.capabilities]).sharedAIConfig!; },
    async updateAutonomy(_handle, input) {
      return { ...emptyProjection(), autonomy: {
        ...emptyProjection().autonomy!, revision: 'autonomy:2',
        enabled: input.enabled ?? null,
        mode: input.mode as AgentCenterAutonomyProjection['mode'],
        dailyTokenBudget: Number(input.dailyTokenBudget),
        maxTokensPerHook: Number(input.maxTokensPerHook),
      } };
    },
    async replaceAppearance() { return emptyProjection(); },
    async restorePreviousAppearance() { return emptyProjection(); },
    ...overrides,
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AgentCenterSession', () => {
  it('awaits the committed shared AIConfig projection before write-back', async () => {
    const calls: string[] = [];
    const configInputs: unknown[] = [];
    let sharedAIConfig = emptyProjection().sharedAIConfig!;
    const session = createFirstPartyAgentCenterSession({
      identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
      sharedAIConfig: {
        async get(input) { calls.push('config.read'); configInputs.push(input); return sharedAIConfig; },
        async overwrite(input) {
          configInputs.push(input);
          calls.push(`config.write:${input.capabilities[0]?.capabilityContract}`);
          const state = emptyProjection([...input.capabilities]).sharedAIConfig!;
          sharedAIConfig = state;
          return sharedAIConfig;
        },
      },
      autonomy: {
        async load() { return emptyProjection().autonomy!; },
        async update(_identity, input) {
          return { ...emptyProjection().autonomy!, enabled: input.enabled ?? null };
        },
      },
    });
    await session.refresh();
    await session.overwriteSharedAIConfig({
      capabilities: [{
        capabilityContract: 'text.generate',
        route: { oneofKind: 'local', local: {} },
        requiredFeatures: ['input.image'],
      }],
    });

    expect(session.getSnapshot().state.sharedAIConfig?.aiConfig.owner?.owner.oneofKind).toBe('runtimeLocalAgentSubsystem');
    expect(session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0]?.requiredFeatures).toEqual(['input.image']);
    expect(calls).toContain('config.write:text.generate');
    expect(configInputs).toEqual([
      { subjectUserId: undefined },
      { subjectUserId: undefined, capabilities: [expect.objectContaining({ capabilityContract: 'text.generate' })] },
      { subjectUserId: undefined },
    ]);
    expect(JSON.stringify(configInputs)).not.toMatch(/ownerUserId|runtimeSourceRef|localAgentRef/u);
    expect(JSON.stringify(session.getSnapshot().state)).not.toContain('targetRef');
  });

  it('treats AI_CONFIG_NOT_FOUND as canonical absence and permits atomic creation', async () => {
    let sharedAIConfig: AgentCenterSharedAIConfigProjection | null = null;
    const session = createFirstPartyAgentCenterSession({
      identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
      sharedAIConfig: {
        async get() {
          if (!sharedAIConfig) throw { reasonCode: 'AI_CONFIG_NOT_FOUND' };
          return sharedAIConfig;
        },
        async overwrite(input) {
          sharedAIConfig = emptyProjection([...input.capabilities]).sharedAIConfig!;
          return sharedAIConfig;
        },
      },
    });

    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      error: null,
      state: {
        runtimeStatus: 'ready',
        sharedAIConfig: null,
        agentAIConfigMutationDisabledReason: null,
      },
      availability: {
        overwriteSharedAIConfig: { state: 'available' },
      },
    });

    await session.overwriteSharedAIConfig({
      capabilities: [{
        capabilityContract: 'text.generate',
        route: { oneofKind: 'local', local: {} },
        requiredFeatures: [],
      }],
    });
    expect(session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities)
      .toEqual([expect.objectContaining({ capabilityContract: 'text.generate' })]);
  });

  it.each([
    ['not_granted', 'needs-grant', 'requestPermission'],
    ['request_pending', 'request-pending', 'wait'],
    ['grant_denied', 'denied', 'requestPermission'],
    ['grant_revoked', 'revoked', 'requestPermission'],
    ['runtime_offline', 'runtime-offline', 'retry'],
    ['reserved_not_admitted', 'reserved-not-admitted', 'wait'],
    ['unknown', 'unknown', 'retry'],
  ] as const)('maps transport reason %s without collapse', (transportReason, reason, nextStep) => {
    expect(projectAgentCenterActionAvailability(transportProjection(transportReason)).updateAutonomy)
      .toEqual({ state: 'unavailable', reason, nextStep });
  });

  it('routes permissioned shared configuration writes without an Agent handle', async () => {
    const calls: string[] = [];
    const session = createPermissionedAgentCenterSession({
      handle: 'opaque' as AgentCenterOpaqueHandle,
      surface: permissionedSurface({
        async overwriteSharedAIConfig(input) {
          calls.push(`config:${input.capabilities.length}`);
          return emptyProjection([...input.capabilities]).sharedAIConfig!;
        },
      }),
    });
    await session.refresh();
    await session.overwriteSharedAIConfig({ capabilities: [] });
    expect(calls).toEqual(['config:0']);
    expect(session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities).toEqual([]);
  });

  it('patches avatar autoplay through the permissioned presentation commit without replacing voice', async () => {
    const calls: AgentCenterPermissionedPresentationCommitInput[] = [];
    const current: AgentCenterStateInput = {
      ...emptyProjection(),
      appearance: {
        status: 'not_configured',
        presentationRevision: 'presentation:1',
        defaultVoiceReference: 'voice_asset_id:voice-song-lian',
        avatarAutoplay: false,
      },
    };
    const updated: AgentCenterStateInput = {
      ...current,
      appearance: { ...current.appearance!, presentationRevision: 'presentation:2', avatarAutoplay: true },
    };
    const session = createPermissionedAgentCenterSession({
      handle: 'opaque' as AgentCenterOpaqueHandle,
      surface: permissionedSurface({
        async read() { return current; },
        async replaceAppearance(_handle, input) { calls.push(input); return updated; },
      }),
    });
    await session.refresh();
    await session.appearance.setAvatarAutoplay?.(true);
    expect(calls).toEqual([{
      expectedRevision: 'presentation:1',
      intent: { avatarAutoplay: true },
      importedAssets: [],
    }]);
    expect(session.getSnapshot().state.appearance).toMatchObject({
      presentationRevision: 'presentation:2',
      defaultVoiceReference: 'voice_asset_id:voice-song-lian',
      avatarAutoplay: true,
    });
  });

  it('recomputes granted posture live without remounting', async () => {
    let emit!: (projection: AgentCenterTransportActionProjection) => void;
    let unsubscribed = false;
    const session = createPermissionedAgentCenterSession({
      handle: 'opaque' as AgentCenterOpaqueHandle,
      surface: permissionedSurface({
        subscribeActionPosture(_handle, listener) {
          emit = listener;
          return () => { unsubscribed = true; };
        },
      }),
    });
    await session.refresh();
    const unsubscribe = session.subscribe(() => undefined);
    await flush();
    emit(recoveryProjection('not_granted'));
    expect(session.getSnapshot().availability.updateAutonomy)
      .toEqual({ state: 'unavailable', reason: 'needs-grant', nextStep: 'requestPermission' });
    unsubscribe();
    expect(unsubscribed).toBe(true);
  });

  it('does not allow hand-assembled transports or state to impersonate trusted outputs', () => {
    const structuralSurface = {} as AgentCenterPermissionedSdkSurfaceInput;
    // @ts-expect-error Permissioned transport surfaces require the Kit sealer private brand.
    const fabricatedSurface: AgentCenterPermissionedSdkSurface = structuralSurface;
    // @ts-expect-error Manager Sessions are nominal factory outputs, not structural caller state.
    const fabricated: AgentCenterSession = {
      getSnapshot() { throw new Error('fabricated'); }, subscribe() { return () => undefined; },
      async refresh() {}, async overwriteSharedAIConfig() {}, async updateAutonomy() {},
      async replaceAppearance() {}, async restorePreviousAppearance() {},
      async requestPermission() {}, async openPermissionSettings() {}, appearance: {},
    };
    expect(fabricatedSurface).toBeTruthy();
    expect(fabricated).toBeTruthy();
  });
});
