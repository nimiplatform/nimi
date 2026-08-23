import {
  asNimiError,
  type NimiAIConfigOptionsQuery,
  type NimiAIConfigOptionsResult,
  type NimiAIConfigSnapshot,
  type NimiSharedLocalAgentAIConfigOverwriteResult,
  type NimiSharedLocalAgentCapabilityParticipation,
  type NimiLocalAppAgentAutonomyProjection,
  type NimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentHandle,
  type NimiLocalAppAgentPresentationIntent,
  type NimiLocalAppAgentPresentationProfile,
  type NimiLocalAppAgentPresentationProjection,
  type NimiRuntimeAgentInspectSurface,
  type NimiRuntimeAgentMemoryObservatorySnapshot,
  type NimiRuntimeAgentSourceContextStatus,
  type NimiRuntimeAgentTurnContextSummary,
  type RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigEffectiveSelectionProjection,
} from '@nimiplatform/kit/features/model-config/headless';
import { buildAgentCenterState, replaceAgentCenterSharedAIConfig } from './state.js';
import type {
  AgentCenterActionAvailability,
  AgentCenterActionAvailabilityProjection,
  AgentCenterActionUnavailableReason,
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceProjection,
  AgentCenterAutonomyMutation,
  AgentCenterAutonomyMutationInput,
  AgentCenterAutonomyProjection,
  AgentCenterAIConfigMutation,
  AgentCenterNextStepAction,
  AgentCenterPresentationCommitInput,
  AgentCenterPresentationIntent,
  AgentCenterSharedAIConfigModule,
  AgentCenterSharedAIConfigProjection,
  AgentCenterProductAction,
  AgentCenterRuntimeLoadInput,
  AgentCenterSession,
  AgentCenterSnapshot,
  AgentCenterState,
  AgentCenterStateInput,
} from './types.js';

const ACTIONS: readonly AgentCenterProductAction[] = [
  'getSharedAIConfig',
  'overwriteSharedAIConfig',
  'readAutonomy',
  'updateAutonomy',
  'readMemorySummary',
  'replaceAppearance',
  'restorePreviousAppearance',
];

const AVAILABLE: AgentCenterActionAvailability = Object.freeze({
  state: 'available', reason: null, nextStep: null,
});

function nextStep(reason: AgentCenterActionUnavailableReason): AgentCenterNextStepAction {
  switch (reason) {
    case 'selection-required':
    case 'unsupported':
    case 'operation-unavailable':
    case 'owner-rejected': return 'openRuntimeSettings';
    case 'runtime-offline':
    case 'unknown': return 'retry';
  }
}

function unavailable(reason: AgentCenterActionUnavailableReason): AgentCenterActionAvailability {
  return Object.freeze({ state: 'unavailable', reason, nextStep: nextStep(reason) });
}

function allUnavailable(reason: AgentCenterActionUnavailableReason): AgentCenterActionAvailabilityProjection {
  return Object.freeze(Object.fromEntries(ACTIONS.map((action) => [action, unavailable(reason)]))) as AgentCenterActionAvailabilityProjection;
}

type SharedAIConfigRead = {
  readonly sharedAIConfig: AgentCenterSharedAIConfigProjection | null;
  readonly effectiveSelections: readonly ModelConfigEffectiveSelectionProjection[];
  readonly participation: readonly NimiSharedLocalAgentCapabilityParticipation[];
};

interface SessionTransport {
  readonly appearanceAdapter: AgentCenterAppearanceAdapter | null;
  actionAvailability(): Promise<AgentCenterActionAvailabilityProjection>;
  read(): Promise<AgentCenterStateInput>;
  readSharedAIConfig(): Promise<SharedAIConfigRead>;
  overwriteSharedAIConfig(input: AgentCenterAIConfigMutation): Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
  listSharedAIConfigOptions(input: NimiAIConfigOptionsQuery): Promise<NimiAIConfigOptionsResult>;
  updateAutonomy(input: AgentCenterAutonomyMutation): Promise<AgentCenterAutonomyProjection>;
  replaceAppearance(input: AgentCenterPresentationCommitInput): Promise<AgentCenterStateInput | AgentCenterState | AgentCenterAppearanceProjection>;
  restorePreviousAppearance(): Promise<AgentCenterStateInput | AgentCenterState | AgentCenterAppearanceProjection>;
}

function isBuiltState(value: AgentCenterState | AgentCenterStateInput): value is AgentCenterState {
  return Array.isArray((value as AgentCenterState).sections)
    && Array.isArray((value as AgentCenterState).capabilities);
}

function stateWithAvailability(
  value: AgentCenterState | AgentCenterStateInput,
  availability: AgentCenterActionAvailabilityProjection,
): AgentCenterState {
  const state = isBuiltState(value) ? value : buildAgentCenterState(value);
  const modelAvailable = availability.overwriteSharedAIConfig.state === 'available';
  const autonomyAvailable = availability.updateAutonomy.state === 'available';
  return {
    ...state,
    agentAIConfigMutationDisabledReason: modelAvailable
      ? state.agentAIConfigMutationDisabledReason
      : 'action-unavailable',
    autonomy: {
      ...state.autonomy,
      controlsDisabled: !autonomyAvailable || state.autonomy.revision === null,
      disabledReason: !autonomyAvailable
        ? availability.updateAutonomy.reason
        : state.autonomy.disabledReason,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Agent Center projection is unavailable.';
}

function isCanonicalAIConfigAbsence(error: unknown): boolean {
  return asNimiError(error).reasonCode === 'AI_CONFIG_NOT_FOUND';
}

function unavailableReasonFromError(error: unknown): AgentCenterActionUnavailableReason {
  switch (asNimiError(error).reasonCode) {
    case 'LOCAL_APP_OPERATION_UNAVAILABLE':
    case 'local-app-operation-unavailable':
      return 'operation-unavailable';
    case 'LOCAL_APP_OPERATION_UNSUPPORTED':
    case 'local-app-operation-unsupported':
    case 'AI_ROUTE_UNSUPPORTED':
    case 'AI_MODALITY_NOT_SUPPORTED':
      return 'unsupported';
    case 'LOCAL_APP_ACCESS_DENIED':
    case 'local-app-access-denied':
    case 'LOCAL_APP_OWNER_UNAVAILABLE':
    case 'local-app-owner-unavailable':
    case 'LOCAL_APP_SESSION_REVOKED':
    case 'LOCAL_APP_ACCOUNT_CHANGED':
      return 'owner-rejected';
    case 'AI_LOCAL_SELECTION_NOT_FOUND':
    case 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED':
    case 'AGENT_AI_CONFIG_TARGET_REQUIRED':
      return 'selection-required';
    case 'RUNTIME_UNAVAILABLE':
    case 'RUNTIME_BRIDGE_DAEMON_UNAVAILABLE':
    case 'SDK_HOST_UNAVAILABLE':
    case 'runtime-service-unavailable':
    case 'renderer-standard-shell-host-unavailable':
      return 'runtime-offline';
    default:
      return 'unknown';
  }
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-006c
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-007
class ManagerSession {
  readonly appearance: AgentCenterSession['appearance'];
  #snapshot: AgentCenterSnapshot;
  #listeners = new Set<() => void>();

  constructor(
    private readonly transport: SessionTransport,
  ) {
    this.#snapshot = {
      phase: 'loading',
      state: stateWithAvailability({}, allUnavailable('unknown')),
      availability: allUnavailable('unknown'),
      error: null,
    };
    const commitAppearance = async (task: () => Promise<AgentCenterAppearanceProjection>) => {
      const projection = await task();
      this.#replaceAppearance(projection);
    };
    const appearance = transport.appearanceAdapter;
    this.appearance = Object.freeze({
      ...(appearance?.replaceAvatar ? { replaceAvatar: (kind: 'live2d' | 'vrm') => commitAppearance(() => appearance.replaceAvatar!(kind)) } : {}),
      ...(appearance?.linkLive2dAdapterManifest ? { linkLive2dAdapterManifest: () => commitAppearance(() => appearance.linkLive2dAdapterManifest!()) } : {}),
      ...(appearance?.clearAvatarAsset ? { clearAvatarAsset: () => commitAppearance(() => appearance.clearAvatarAsset!()) } : {}),
      ...(appearance?.importBackground ? { importBackground: () => commitAppearance(() => appearance.importBackground!()) } : {}),
      ...(appearance?.clearBackground ? { clearBackground: () => commitAppearance(() => appearance.clearBackground!()) } : {}),
      ...(appearance?.removeAgentResources ? { removeAgentResources: () => commitAppearance(() => appearance.removeAgentResources!()) } : {}),
      ...(appearance?.cleanupGeneratedVoiceArtifacts ? { cleanupGeneratedVoiceArtifacts: () => commitAppearance(() => appearance.cleanupGeneratedVoiceArtifacts!()) } : {}),
      ...(appearance?.setDefaultVoice ? { setDefaultVoice: (reference: string) => commitAppearance(() => appearance.setDefaultVoice!(reference)) } : {}),
      ...(appearance?.setAvatarAutoplay ? { setAvatarAutoplay: (enabled: boolean) => commitAppearance(() => appearance.setAvatarAutoplay!(enabled)) } : {}),
    });
  }

  getSnapshot = (): AgentCenterSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      void this.refresh();
    }
    return () => {
      this.#listeners.delete(listener);
    };
  };

  async refresh(): Promise<void> {
    this.#set({ ...this.#snapshot, phase: 'loading', error: null });
    try {
      const state = await this.transport.read();
      const availability = await this.transport.actionAvailability();
      this.#set({ phase: 'ready', state: stateWithAvailability(state, availability), availability, error: null });
    } catch (error) {
      const availability = allUnavailable(unavailableReasonFromError(error));
      this.#set({
        phase: 'degraded',
        state: stateWithAvailability(this.#snapshot.state, availability),
        availability,
        error: errorMessage(error),
      });
    }
  }

  async overwriteSharedAIConfig(input: AgentCenterAIConfigMutation): Promise<NimiSharedLocalAgentAIConfigOverwriteResult> {
    this.#requireAvailable('overwriteSharedAIConfig');
    const result = await this.transport.overwriteSharedAIConfig(input);
    const sharedAIConfig = result.config
      ? projectAppSharedAIConfig(result.config, result.revision)
      : null;
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      state: stateWithAvailability(
        replaceAgentCenterSharedAIConfig(
          this.#snapshot.state,
          sharedAIConfig,
          [],
          result.participation,
        ),
        this.#snapshot.availability,
      ),
      error: null,
    });
    if (result.config) void this.#refreshSharedAIConfigEffectiveSelections(result.revision);
    return result;
  }

  async #refreshSharedAIConfigEffectiveSelections(expectedRevision: string): Promise<void> {
    try {
      const refreshed = await this.transport.readSharedAIConfig();
      const currentRevision = this.#snapshot.state.sharedAIConfig?.revision ?? '0';
      const refreshedRevision = refreshed.sharedAIConfig?.revision ?? '0';
      if (currentRevision !== expectedRevision || refreshedRevision !== expectedRevision) return;
      this.#set({
        ...this.#snapshot,
        state: stateWithAvailability(
          replaceAgentCenterSharedAIConfig(
            this.#snapshot.state,
            refreshed.sharedAIConfig,
            refreshed.effectiveSelections,
            refreshed.participation,
          ),
          this.#snapshot.availability,
        ),
      });
    } catch {
      // The mutation acknowledgement remains authoritative. A later read
      // failure leaves effective facts unknown until the next successful read.
    }
  }

  async listSharedAIConfigOptions(input: NimiAIConfigOptionsQuery): Promise<NimiAIConfigOptionsResult> {
    this.#requireAvailable('overwriteSharedAIConfig');
    return this.transport.listSharedAIConfigOptions(input);
  }

  async updateAutonomy(input: AgentCenterAutonomyMutation): Promise<void> {
    this.#requireAvailable('updateAutonomy');
    const autonomy = await this.transport.updateAutonomy(input);
    const availability = this.#snapshot.availability.updateAutonomy;
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      state: {
        ...this.#snapshot.state,
        autonomyRevision: autonomy.revision,
        autonomy: {
          revision: autonomy.revision,
          enabled: autonomy.enabled,
          mode: autonomy.mode,
          usedTokensInWindow: autonomy.usedTokensInWindow,
          dailyTokenBudget: autonomy.dailyTokenBudget,
          maxTokensPerHook: autonomy.maxTokensPerHook,
          windowStartedAt: autonomy.windowStartedAt,
          suspendedUntil: autonomy.suspendedUntil,
          budgetExhausted: autonomy.budgetExhausted,
          controlsDisabled: availability.state === 'unavailable' || autonomy.revision === null,
          disabledReason: availability.state === 'unavailable'
            ? availability.reason
            : autonomy.revision === null ? 'runtime autonomy revision unavailable' : null,
        },
      },
      error: null,
    });
  }

  async replaceAppearance(input: AgentCenterPresentationCommitInput): Promise<void> {
    this.#requireAvailable('replaceAppearance');
    const result = await this.transport.replaceAppearance(input);
    if ('status' in result && !('runtimeStatus' in result) && !('agentAIConfig' in result)) {
      this.#replaceAppearance(result as AgentCenterAppearanceProjection);
    } else {
      this.#replaceState(result as AgentCenterState | AgentCenterStateInput);
    }
  }

  async restorePreviousAppearance(): Promise<void> {
    this.#requireAvailable('restorePreviousAppearance');
    const result = await this.transport.restorePreviousAppearance();
    if ('status' in result && !('runtimeStatus' in result) && !('agentAIConfig' in result)) {
      this.#replaceAppearance(result as AgentCenterAppearanceProjection);
    } else {
      this.#replaceState(result as AgentCenterState | AgentCenterStateInput);
    }
  }

  #requireAvailable(action: AgentCenterProductAction): void {
    const availability = this.#snapshot.availability[action];
    if (availability.state === 'unavailable') {
      throw new Error(`Agent Center action unavailable: ${availability.reason}`);
    }
  }

  #replaceState(value: AgentCenterState | AgentCenterStateInput): void {
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      state: stateWithAvailability(value, this.#snapshot.availability),
      error: null,
    });
  }

  #replaceAppearance(projection: AgentCenterAppearanceProjection): void {
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      state: {
        ...this.#snapshot.state,
        presentationRevision: projection.presentationRevision ?? this.#snapshot.state.presentationRevision,
        appearance: projection,
      },
      error: null,
    });
  }

  #set(snapshot: AgentCenterSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

}

export interface CreateFirstPartyAgentCenterSessionInput {
  readonly sharedAIConfig: AgentCenterSharedAIConfigModule;
  readonly inspect?: NimiRuntimeAgentInspectSurface | null;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly autonomy?: {
    readonly load: (input: RuntimeLocalAgentIdentityInput) => Promise<AgentCenterAutonomyProjection | null>;
    readonly update: (
      input: RuntimeLocalAgentIdentityInput,
      mutation: AgentCenterAutonomyMutationInput,
    ) => Promise<AgentCenterAutonomyProjection>;
  } | null;
  readonly appearance?: AgentCenterAppearanceAdapter | null;
  readonly loadMemory?: (input: RuntimeLocalAgentIdentityInput) => Promise<NimiRuntimeAgentMemoryObservatorySnapshot | null>;
  readonly loadSourceContextStatus?: (input: RuntimeLocalAgentIdentityInput) => Promise<NimiRuntimeAgentSourceContextStatus | null>;
  readonly loadTurnContextSummary?: (
    input: RuntimeLocalAgentIdentityInput & { readonly conversationAnchorId?: string },
  ) => Promise<NimiRuntimeAgentTurnContextSummary | null>;
  readonly loadInput?: AgentCenterRuntimeLoadInput;
}

function firstPartyActionAvailability(
  input: CreateFirstPartyAgentCenterSessionInput,
): AgentCenterActionAvailabilityProjection {
  const appearanceWritable = Boolean(
    input.appearance?.replaceAppearance
    || input.appearance?.replaceAvatar
    || input.appearance?.linkLive2dAdapterManifest
    || input.appearance?.clearAvatarAsset
    || input.appearance?.importBackground
    || input.appearance?.clearBackground
    || input.appearance?.removeAgentResources
    || input.appearance?.cleanupGeneratedVoiceArtifacts
    || input.appearance?.setDefaultVoice
    || input.appearance?.setAvatarAutoplay,
  );
  const availability: AgentCenterActionAvailabilityProjection = {
    getSharedAIConfig: AVAILABLE,
    overwriteSharedAIConfig: AVAILABLE,
    readAutonomy: input.autonomy ? AVAILABLE : unavailable('operation-unavailable'),
    updateAutonomy: input.autonomy ? AVAILABLE : unavailable('operation-unavailable'),
    readMemorySummary: input.loadMemory || input.inspect
      ? AVAILABLE
      : unavailable('operation-unavailable'),
    replaceAppearance: appearanceWritable
      ? AVAILABLE
      : unavailable('operation-unavailable'),
    restorePreviousAppearance: input.appearance?.restorePreviousAppearance
      ? AVAILABLE
      : unavailable('operation-unavailable'),
  };
  return Object.freeze(availability);
}

export function createFirstPartyAgentCenterSession(
  input: CreateFirstPartyAgentCenterSessionInput,
): AgentCenterSession {
  const identity = input.loadInput?.identity || input.identity;
  const aiConfigAccountInput = { subjectUserId: input.loadInput?.subjectUserId };
  const readSharedAIConfig = async (): Promise<SharedAIConfigRead> => {
    try {
      const snapshot = await input.sharedAIConfig.get(aiConfigAccountInput);
      return {
        sharedAIConfig: snapshot.config ? projectAppSharedAIConfig(snapshot.config, snapshot.revision) : null,
        effectiveSelections: projectAIConfigEffectiveSelections(snapshot),
        participation: Object.freeze([...(snapshot.participation ?? [])]),
      };
    } catch (error) {
      if (isCanonicalAIConfigAbsence(error)) return { sharedAIConfig: null, effectiveSelections: [], participation: [] };
      throw error;
    }
  };
  const read = async (): Promise<AgentCenterStateInput> => {
    const [shared, autonomy, inspect, memory, sourceContextStatus, turnContextSummary, appearance] = await Promise.all([
      readSharedAIConfig(),
      input.autonomy?.load(identity) ?? Promise.resolve(null),
      input.inspect?.getPublicInspect(identity) ?? Promise.resolve(null),
      input.loadMemory?.(identity) ?? Promise.resolve(null),
      input.loadSourceContextStatus?.(identity) ?? Promise.resolve(null),
      input.loadTurnContextSummary?.({
        ...identity,
        ...(input.loadInput?.conversationAnchorId ? { conversationAnchorId: input.loadInput.conversationAnchorId } : {}),
      }) ?? Promise.resolve(null),
      input.appearance?.load() ?? Promise.resolve(null),
    ]);
    return {
      sharedAIConfig: shared.sharedAIConfig,
      effectiveSelections: shared.effectiveSelections,
      participation: shared.participation,
      autonomy, inspect, memory, sourceContextStatus, turnContextSummary, appearance,
    };
  };
  const transport: SessionTransport = {
    appearanceAdapter: input.appearance || null,
    actionAvailability: async () => firstPartyActionAvailability(input),
    read,
    readSharedAIConfig,
    async overwriteSharedAIConfig(mutation) {
      return input.sharedAIConfig.overwrite({
        subjectUserId: input.loadInput?.subjectUserId,
        expectedRevision: mutation.expectedRevision,
        capabilities: mutation.capabilities,
        ...(mutation.displayProvenance ? { displayProvenance: mutation.displayProvenance } : {}),
      });
    },
    async listSharedAIConfigOptions(query) {
      return input.sharedAIConfig.listOptions({
        ...query,
        subjectUserId: input.loadInput?.subjectUserId,
      });
    },
    async updateAutonomy(mutation) {
      if (!input.autonomy) throw new Error('Agent Center autonomy transport is unavailable.');
      return input.autonomy.update(identity, mutation);
    },
    async replaceAppearance(mutation) {
      if (!input.appearance?.replaceAppearance) {
        throw new Error('Agent Center atomic appearance replacement transport is not connected.');
      }
      return input.appearance.replaceAppearance(mutation);
    },
    async restorePreviousAppearance() {
      if (!input.appearance?.restorePreviousAppearance) throw new Error('Agent Center restore transport is unavailable.');
      return input.appearance.restorePreviousAppearance();
    },
  };
  return new ManagerSession(transport) as unknown as AgentCenterSession;
}

export interface CreateAppAgentCenterSessionInput {
  readonly handle: NimiLocalAppAgentHandle;
  readonly client: NimiLocalAppAgentConfigureClient;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-010a
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-006c
export function createAppAgentCenterSession(
  input: CreateAppAgentCenterSessionInput,
): AgentCenterSession {
  const handle = input.handle;
  let manager: ManagerSession | null = null;
  let presentation: NimiLocalAppAgentPresentationProjection | null = null;

  const readSharedAIConfig = async (): Promise<SharedAIConfigRead> => {
    try {
      const snapshot = await input.client.sharedAIConfig.get();
      return {
        sharedAIConfig: snapshot.config ? projectAppSharedAIConfig(snapshot.config, snapshot.revision) : null,
        effectiveSelections: projectAIConfigEffectiveSelections(snapshot),
        participation: Object.freeze([...(snapshot.participation ?? [])]),
      };
    } catch (error) {
      if (isCanonicalAIConfigAbsence(error)) return { sharedAIConfig: null, effectiveSelections: [], participation: [] };
      throw error;
    }
  };

  const read = async (): Promise<AgentCenterStateInput> => {
    const [shared, autonomy, nextPresentation] = await Promise.all([
      readSharedAIConfig(),
      input.client.autonomy.snapshot({ agentHandle: handle }),
      input.client.presentation.snapshot({ agentHandle: handle }),
    ]);
    presentation = nextPresentation;
    return {
      sharedAIConfig: shared.sharedAIConfig,
      effectiveSelections: shared.effectiveSelections,
      participation: shared.participation,
      autonomy: projectAppAutonomy(autonomy),
      appearance: projectAppAppearance(nextPresentation),
    };
  };

  const currentPresentation = async (): Promise<NimiLocalAppAgentPresentationProjection> => {
    if (presentation) return presentation;
    presentation = await input.client.presentation.snapshot({ agentHandle: handle });
    return presentation;
  };

  const commitPresentation = async (
    mutation: AgentCenterPresentationCommitInput,
  ): Promise<AgentCenterAppearanceProjection> => {
    const current = await currentPresentation();
    presentation = await input.client.presentation.commit({
      agentHandle: handle,
      expectedPresentationRevision: mutation.expectedRevision,
      intent: mergeAppPresentationIntent(current.profile, mutation.intent),
      importedAssets: mutation.importedAssets,
    });
    return projectAppAppearance(presentation);
  };

  const appearanceAdapter: AgentCenterAppearanceAdapter = {
    async load() {
      return projectAppAppearance(await currentPresentation());
    },
    async setAvatarAutoplay(enabled) {
      const current = manager?.getSnapshot().state.appearance;
      const expectedRevision = current?.presentationRevision;
      if (expectedRevision === null || expectedRevision === undefined) {
        throw new Error('Agent Center Runtime presentation revision is unavailable.');
      }
      return commitPresentation({
        expectedRevision,
        intent: { avatarAutoplay: enabled },
        importedAssets: [],
      });
    },
    async setDefaultVoice(reference) {
      const current = manager?.getSnapshot().state.appearance;
      const expectedRevision = current?.presentationRevision;
      if (expectedRevision === null || expectedRevision === undefined) {
        throw new Error('Agent Center Runtime presentation revision is unavailable.');
      }
      return commitPresentation({
        expectedRevision,
        intent: { defaultVoiceReference: reference },
        importedAssets: [],
      });
    },
  };

  const appAvailability = (): AgentCenterActionAvailabilityProjection => Object.freeze({
    getSharedAIConfig: AVAILABLE,
    overwriteSharedAIConfig: AVAILABLE,
    readAutonomy: AVAILABLE,
    updateAutonomy: AVAILABLE,
    readMemorySummary: unavailable('operation-unavailable'),
    replaceAppearance: presentation?.profile
      ? AVAILABLE
      : unavailable('selection-required'),
    restorePreviousAppearance: presentation?.previousProfile
      ? AVAILABLE
      : unavailable('selection-required'),
  });

  const transport: SessionTransport = {
    appearanceAdapter,
    actionAvailability: async () => appAvailability(),
    read,
    readSharedAIConfig,
    async overwriteSharedAIConfig(mutation) {
      return input.client.sharedAIConfig.overwrite({
        expectedRevision: mutation.expectedRevision,
        capabilities: mutation.capabilities,
      });
    },
    async listSharedAIConfigOptions(query) {
      return input.client.sharedAIConfig.listOptions(query);
    },
    async updateAutonomy(mutation) {
      const autonomy = await input.client.autonomy.update({
        agentHandle: handle,
        expectedAutonomyRevision: mutation.expectedRevision,
        intent: {
          ...(mutation.enabled === undefined ? {} : { enabled: mutation.enabled }),
          config: {
            mode: mutation.mode,
            dailyTokenBudget: mutation.dailyTokenBudget,
            maxTokensPerHook: mutation.maxTokensPerHook,
          },
        },
      });
      return projectAppAutonomy(autonomy);
    },
    replaceAppearance: commitPresentation,
    async restorePreviousAppearance() {
      const current = await currentPresentation();
      if (!current.previousProfile) {
        throw new Error('Agent Center previous presentation is unavailable.');
      }
      presentation = await input.client.presentation.commit({
        agentHandle: handle,
        expectedPresentationRevision: current.presentationRevision,
        intent: appPresentationIntent(current.previousProfile),
        importedAssets: [],
      });
      return projectAppAppearance(presentation);
    },
  };
  manager = new ManagerSession(transport);
  return manager as unknown as AgentCenterSession;
}

function projectAppSharedAIConfig(
  aiConfig: AgentCenterSharedAIConfigProjection['aiConfig'],
  revision: string,
): AgentCenterSharedAIConfigProjection {
  const intents = aiConfig.capabilities.map((intent) => {
    const route = intent.route.oneofKind;
    if (route !== 'local' && route !== 'cloud') {
      throw new Error(`Shared LocalAgent AIConfig capability ${intent.capabilityContract} has no Local or Cloud intent.`);
    }
    return Object.freeze({
      capability: intent.capabilityContract,
      route,
      requiredFeatures: Object.freeze([...intent.requiredFeatures]),
    });
  });
  return Object.freeze({
    aiConfig,
    revision,
    intents: Object.freeze(intents),
  });
}

function projectAIConfigEffectiveSelections(
  snapshot: NimiAIConfigSnapshot,
): readonly ModelConfigEffectiveSelectionProjection[] {
  return Object.freeze([...snapshot.effectiveSelections]);
}

function projectAppAutonomy(
  projection: NimiLocalAppAgentAutonomyProjection,
): AgentCenterAutonomyProjection {
  return Object.freeze({
    revision: projection.autonomyRevision,
    mode: projection.config?.mode ?? null,
    enabled: projection.enabled,
    budgetExhausted: projection.budgetExhausted,
    usedTokensInWindow: projection.usedTokensInWindow,
    dailyTokenBudget: projection.config?.dailyTokenBudget ?? null,
    maxTokensPerHook: projection.config?.maxTokensPerHook ?? null,
    windowStartedAt: appTimestampToIso(projection.windowStartedAt),
    suspendedUntil: appTimestampToIso(projection.suspendedUntil),
  });
}

function projectAppAppearance(
  projection: NimiLocalAppAgentPresentationProjection,
): AgentCenterAppearanceProjection {
  const profile = projection.profile;
  return Object.freeze({
    status: profile?.avatarAssetRef ? 'ready' : 'not_configured',
    presentationRevision: projection.presentationRevision,
    backendKind: profile?.backendKind ?? null,
    avatarAssetRef: profile?.avatarAssetRef || null,
    backgroundRef: profile?.backgroundAssetRef || null,
    defaultVoiceReference: profile?.defaultVoiceReference || projection.defaultVoiceReference || null,
    avatarAutoplay: profile?.avatarAutoplay ?? false,
    previousSelection: projection.previousProfile
      ? projectAppPresentationIntent(projection.previousProfile)
      : null,
    avatarImportDisabled: true,
    backgroundImportDisabled: true,
    disabledReasonCode: profile?.avatarAssetRef ? null : 'avatar-not-configured',
    disabledReason: profile?.avatarAssetRef ? null : 'appearance asset not configured',
  });
}

function projectAppPresentationIntent(
  profile: NimiLocalAppAgentPresentationProfile,
): AgentCenterPresentationIntent {
  return Object.freeze({
    backendKind: profile.backendKind,
    avatarAssetReference: profile.avatarAssetRef,
    defaultVoiceReference: profile.defaultVoiceReference,
    avatarAutoplay: profile.avatarAutoplay,
    backgroundAssetReference: profile.backgroundAssetRef,
  });
}

function mergeAppPresentationIntent(
  current: NimiLocalAppAgentPresentationProfile | null,
  patch: AgentCenterPresentationIntent,
): NimiLocalAppAgentPresentationIntent {
  const backendKind = patch.backendKind === null
    ? null
    : patch.backendKind ?? current?.backendKind;
  if (!backendKind) {
    throw new Error('Agent Center presentation backend is unavailable.');
  }
  return Object.freeze({
    backendKind,
    avatarAssetRef: patchedPresentationText(patch.avatarAssetReference, current?.avatarAssetRef),
    expressionProfileRef: current?.expressionProfileRef ?? '',
    idlePreset: current?.idlePreset ?? '',
    interactionPolicyRef: current?.interactionPolicyRef ?? '',
    defaultVoiceReference: patchedPresentationText(
      patch.defaultVoiceReference,
      current?.defaultVoiceReference,
    ),
    avatarAutoplay: patch.avatarAutoplay ?? current?.avatarAutoplay ?? false,
    backgroundAssetRef: patchedPresentationText(
      patch.backgroundAssetReference,
      current?.backgroundAssetRef,
    ),
  });
}

function patchedPresentationText(
  value: string | null | undefined,
  current: string | undefined,
): string {
  if (value === null) return '';
  return value === undefined ? current ?? '' : value;
}

function appPresentationIntent(
  profile: NimiLocalAppAgentPresentationProfile,
): NimiLocalAppAgentPresentationIntent {
  return Object.freeze({
    backendKind: profile.backendKind,
    avatarAssetRef: profile.avatarAssetRef,
    expressionProfileRef: profile.expressionProfileRef,
    idlePreset: profile.idlePreset,
    interactionPolicyRef: profile.interactionPolicyRef,
    defaultVoiceReference: profile.defaultVoiceReference,
    avatarAutoplay: profile.avatarAutoplay,
    backgroundAssetRef: profile.backgroundAssetRef,
  });
}

function appTimestampToIso(
  value: NimiLocalAppAgentAutonomyProjection['windowStartedAt'],
): string | null {
  if (!value) return null;
  const millis = (BigInt(value.seconds) * 1_000n) + BigInt(Math.floor(value.nanos / 1_000_000));
  const numeric = Number(millis);
  if (!Number.isSafeInteger(numeric)) return null;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
