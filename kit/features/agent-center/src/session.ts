import {
  asNimiError,
  type NimiSharedLocalAgentAIConfigOptionsQuery,
  type NimiSharedLocalAgentAIConfigOptionsResult,
  type NimiAIConfigSnapshot,
  type NimiSharedLocalAgentAIConfigOverwriteResult,
  type NimiSharedLocalAgentCapabilityParticipation,
  type NimiLocalAppAgentAutonomyProjection,
  type NimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentHandle,
  type NimiLocalAppAgentPresentationIntent,
  type NimiLocalAppAgentPresentationProfile,
  type NimiLocalAppAgentPresentationProjection,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigEffectiveSelectionProjection,
} from '@nimiplatform/kit/features/model-config/headless';
import { isAvatarControlledPreviewSurfaceRef } from '@nimiplatform/kit/features/avatar/headless';
import { buildAgentCenterState, replaceAgentCenterMemoryProjection, replaceAgentCenterSharedAIConfig } from './state.js';
import type {
  AgentCenterActionAvailability,
  AgentCenterActionAvailabilityProjection,
  AgentCenterActionUnavailableReason,
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceProjection,
  AgentCenterHostAppearanceSelection,
  AgentCenterHostCommittedPreviewEvidence,
  AgentCenterHostMechanics,
  AgentCenterVoiceCatalogProjection,
  AgentCenterAutonomyMutation,
  AgentCenterAutonomyProjection,
  AgentCenterAIConfigMutation,
  AgentCenterMemoryMutationResult,
  AgentCenterMemoryProjection,
  AgentCenterNextStepAction,
  AgentCenterPresentationCommitInput,
  AgentCenterPresentationIntent,
  AgentCenterSharedAIConfigProjection,
  AgentCenterProductAction,
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
  'inspectMemory',
  'correctMemory',
  'forgetMemory',
  'switchMemory',
  'deleteAllMemory',
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
  listSharedAIConfigOptions(input: NimiSharedLocalAgentAIConfigOptionsQuery): Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
  updateAutonomy(input: AgentCenterAutonomyMutation): Promise<AgentCenterAutonomyProjection>;
  correctMemory(input: { readonly memoryId: string; readonly correctedContent: string }): Promise<AgentCenterMemoryMutationResult>;
  forgetMemory(input: { readonly memoryIds: readonly string[]; readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult>;
  setMemoryEnabled(enabled: boolean): Promise<AgentCenterMemoryMutationResult>;
  deleteAllMemory(input: { readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult>;
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
  #generation = 0;
  #invalidated = false;

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
      const projection = await this.#runAction('replaceAppearance', task);
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

  invalidate = (): void => {
    if (this.#invalidated) return;
    this.#invalidated = true;
    this.#generation += 1;
    const availability = allUnavailable('owner-rejected');
    this.#set({
      phase: 'degraded',
      state: stateWithAvailability(this.#snapshot.state, availability),
      availability,
      error: 'Agent Center session was invalidated after its account, session, or Agent handle changed.',
    });
  };

  dispose = (): void => {
    this.invalidate();
    this.#listeners.clear();
  };

  subscribe = (listener: () => void): (() => void) => {
    if (this.#invalidated) {
      listener();
      return () => undefined;
    }
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      void this.refresh();
    }
    return () => {
      this.#listeners.delete(listener);
    };
  };

  async refresh(): Promise<void> {
    this.#assertActive();
    const generation = ++this.#generation;
    this.#set({ ...this.#snapshot, phase: 'loading', error: null });
    try {
      const state = await this.transport.read();
      const availability = await this.transport.actionAvailability();
      if (!this.#isCurrent(generation)) return;
      this.#set({ phase: 'ready', state: stateWithAvailability(state, availability), availability, error: null });
    } catch (error) {
      if (!this.#isCurrent(generation)) return;
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
    const result = await this.#runAction(
      'overwriteSharedAIConfig',
      () => this.transport.overwriteSharedAIConfig(input),
    );
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
    if (this.#invalidated) return;
    const generation = this.#generation;
    try {
      const refreshed = await this.transport.readSharedAIConfig();
      if (!this.#isCurrent(generation)) return;
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

  async listSharedAIConfigOptions(input: NimiSharedLocalAgentAIConfigOptionsQuery): Promise<NimiSharedLocalAgentAIConfigOptionsResult> {
    this.#requireAvailable('overwriteSharedAIConfig');
    return this.#runAction(
      'overwriteSharedAIConfig',
      () => this.transport.listSharedAIConfigOptions(input),
    );
  }

  async updateAutonomy(input: AgentCenterAutonomyMutation): Promise<void> {
    this.#requireAvailable('updateAutonomy');
    const autonomy = await this.#runAction('updateAutonomy', () => this.transport.updateAutonomy(input));
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

  async correctMemory(input: { readonly memoryId: string; readonly correctedContent: string }): Promise<void> {
    this.#requireAvailable('correctMemory');
    this.#replaceMemory((await this.#runAction('correctMemory', () => this.transport.correctMemory(input))).projection);
  }

  async forgetMemory(input: { readonly memoryIds: readonly string[]; readonly confirmed: true }): Promise<void> {
    this.#requireAvailable('forgetMemory');
    this.#replaceMemory((await this.#runAction('forgetMemory', () => this.transport.forgetMemory(input))).projection);
  }

  async setMemoryEnabled(enabled: boolean): Promise<void> {
    this.#requireAvailable('switchMemory');
    this.#replaceMemory((await this.#runAction('switchMemory', () => this.transport.setMemoryEnabled(enabled))).projection);
  }

  async deleteAllMemory(input: { readonly confirmed: true }): Promise<void> {
    this.#requireAvailable('deleteAllMemory');
    this.#replaceMemory((await this.#runAction('deleteAllMemory', () => this.transport.deleteAllMemory(input))).projection);
  }

  async replaceAppearance(input: AgentCenterPresentationCommitInput): Promise<void> {
    this.#requireAvailable('replaceAppearance');
    const result = await this.#runAction('replaceAppearance', () => this.transport.replaceAppearance(input));
    if ('status' in result && !('runtimeStatus' in result) && !('agentAIConfig' in result)) {
      this.#replaceAppearance(result as AgentCenterAppearanceProjection);
    } else {
      this.#replaceState(result as AgentCenterState | AgentCenterStateInput);
    }
  }

  async restorePreviousAppearance(): Promise<void> {
    this.#requireAvailable('restorePreviousAppearance');
    const result = await this.#runAction('restorePreviousAppearance', () => this.transport.restorePreviousAppearance());
    if ('status' in result && !('runtimeStatus' in result) && !('agentAIConfig' in result)) {
      this.#replaceAppearance(result as AgentCenterAppearanceProjection);
    } else {
      this.#replaceState(result as AgentCenterState | AgentCenterStateInput);
    }
  }

  #requireAvailable(action: AgentCenterProductAction): void {
    this.#assertActive();
    const availability = this.#snapshot.availability[action];
    if (availability.state === 'unavailable') {
      throw new Error(`Agent Center action unavailable: ${availability.reason}`);
    }
  }

  #replaceState(value: AgentCenterState | AgentCenterStateInput): void {
    if (this.#invalidated) return;
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      state: stateWithAvailability(value, this.#snapshot.availability),
      error: null,
    });
  }

  #replaceAppearance(projection: AgentCenterAppearanceProjection): void {
    if (this.#invalidated) return;
    const availability = Object.freeze({
      ...this.#snapshot.availability,
      restorePreviousAppearance: projection.previousSelection
        ? AVAILABLE
        : unavailable('selection-required'),
    });
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      availability,
      state: stateWithAvailability({
        ...this.#snapshot.state,
        presentationRevision: projection.presentationRevision ?? this.#snapshot.state.presentationRevision,
        appearance: projection,
      }, availability),
      error: null,
    });
  }

  #replaceMemory(projection: AgentCenterMemoryProjection): void {
    if (this.#invalidated) return;
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      state: stateWithAvailability(replaceAgentCenterMemoryProjection(this.#snapshot.state, projection), this.#snapshot.availability),
      error: null,
    });
  }

  #set(snapshot: AgentCenterSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

  #assertActive(): void {
    if (this.#invalidated) {
      throw new Error('Agent Center session is invalidated; create a session for the current Agent handle.');
    }
  }

  #isCurrent(generation: number): boolean {
    return !this.#invalidated && this.#generation === generation;
  }

  async #runAction<T>(action: AgentCenterProductAction, task: () => Promise<T>): Promise<T> {
    this.#assertActive();
    const generation = ++this.#generation;
    try {
      const result = await task();
      if (!this.#isCurrent(generation)) {
        throw new Error('Agent Center session changed before the operation completed.');
      }
      return result;
    } catch (error) {
      if (this.#isCurrent(generation)) this.#degradeAction(action, error);
      throw error;
    }
  }

  #degradeAction(action: AgentCenterProductAction, error: unknown): void {
    const availability = Object.freeze({
      ...this.#snapshot.availability,
      [action]: unavailable(unavailableReasonFromError(error)),
    });
    this.#set({
      phase: 'degraded',
      state: stateWithAvailability(this.#snapshot.state, availability),
      availability,
      error: errorMessage(error),
    });
  }

}

export interface CreateAppAgentCenterSessionInput {
  readonly handle: NimiLocalAppAgentHandle;
  readonly client: NimiLocalAppAgentConfigureClient;
  readonly conversationAnchorId?: string;
  readonly hostMechanics?: AgentCenterHostMechanics | null;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-010a
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-006c
export function createAppAgentCenterSession(
  input: CreateAppAgentCenterSessionInput,
): AgentCenterSession {
  const handle = input.handle;
  let manager: ManagerSession | null = null;
  let presentation: NimiLocalAppAgentPresentationProjection | null = null;
  let readSucceeded = false;
  let voiceCatalog: AgentCenterVoiceCatalogProjection = {
    state: 'unavailable', sourceLabel: null, options: [], truncated: false, message: 'Runtime voice catalog has not been loaded.',
  };

  const readPresetVoiceCatalog = async (): Promise<AgentCenterVoiceCatalogProjection> => {
    try {
      const result = await input.client.sharedAIConfig.listOptions({ kind: 'preset-voices' });
      if (result.kind !== 'preset-voices') throw new Error('Shared LocalAgent preset voice options mismatch.');
      return {
        state: 'ready',
        sourceLabel: 'Shared LocalAgent preset voices',
        options: result.options.map((voice) => ({
          reference: `preset_voice_id:${voice.voiceId}`,
          kind: 'preset_voice_id' as const,
          name: voice.name,
          supportedLangs: [...voice.supportedLangs],
        })),
        truncated: result.truncated,
        message: null,
      };
    } catch (error) {
      return {
        state: 'unavailable', sourceLabel: null, options: [], truncated: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };

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
    readSucceeded = false;
    const [shared, autonomy, nextPresentation, nextVoiceCatalog, cognitionMemory, managerSnapshot] = await Promise.all([
      readSharedAIConfig(),
      input.client.autonomy.snapshot({ agentHandle: handle }),
      input.client.presentation.snapshot({ agentHandle: handle }),
      readPresetVoiceCatalog(),
      input.client.memory.inspect({ agentHandle: handle }),
      input.client.manager.snapshot({
        agentHandle: handle,
        ...(input.conversationAnchorId ? { conversationAnchorId: input.conversationAnchorId } : {}),
      }),
    ]);
    presentation = nextPresentation;
    voiceCatalog = nextVoiceCatalog;
    const appearance = await projectAppAppearanceWithHostPreview(
      nextPresentation,
      voiceCatalog,
      input.hostMechanics,
    );
    readSucceeded = true;
    return {
      sharedAIConfig: shared.sharedAIConfig,
      effectiveSelections: shared.effectiveSelections,
      participation: shared.participation,
      autonomy: projectAppAutonomy(autonomy),
      manager: managerSnapshot,
      appearance,
      cognitionMemory,
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
    presentation = await input.client.presentation.commit({
      agentHandle: handle,
      expectedPresentationRevision: mutation.expectedRevision,
      intent: appPresentationPatch(mutation.intent),
      importedAssets: mutation.importedAssets,
    });
    return projectAppAppearanceWithHostPreview(presentation, voiceCatalog, input.hostMechanics);
  };

  const appearanceAdapter: AgentCenterAppearanceAdapter = {
    async load() {
      const [current, nextVoiceCatalog] = await Promise.all([
        currentPresentation(),
        readPresetVoiceCatalog(),
      ]);
      voiceCatalog = nextVoiceCatalog;
      return projectAppAppearanceWithHostPreview(current, voiceCatalog, input.hostMechanics);
    },
    ...(input.hostMechanics?.selectAvatar ? {
      async replaceAvatar(kind: 'live2d' | 'vrm') {
        const selection = await input.hostMechanics!.selectAvatar!(kind);
        assertHostAppearanceSelection(selection, 'avatar');
        if (selection.intent.backendKind !== kind) {
          throw new Error('Agent Center Host avatar selection backend does not match the requested backend.');
        }
        return commitPresentation({
          expectedRevision: currentPresentationRevision(manager),
          intent: selection.intent,
          importedAssets: selection.importedAssets,
        });
      },
    } : {}),
    ...(input.hostMechanics?.selectBackground ? {
      async importBackground() {
        const selection = await input.hostMechanics!.selectBackground!();
        assertHostAppearanceSelection(selection, 'background');
        return commitPresentation({
          expectedRevision: currentPresentationRevision(manager),
          intent: selection.intent,
          importedAssets: selection.importedAssets,
        });
      },
    } : {}),
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
    ...(readSucceeded ? {
      getSharedAIConfig: AVAILABLE,
      overwriteSharedAIConfig: AVAILABLE,
      readAutonomy: AVAILABLE,
      updateAutonomy: AVAILABLE,
      inspectMemory: AVAILABLE,
      correctMemory: AVAILABLE,
      forgetMemory: AVAILABLE,
      switchMemory: AVAILABLE,
      deleteAllMemory: AVAILABLE,
      replaceAppearance: appearanceAdapter.setDefaultVoice
        || appearanceAdapter.setAvatarAutoplay
        || appearanceAdapter.replaceAvatar
        || appearanceAdapter.importBackground
        ? AVAILABLE
        : unavailable('operation-unavailable'),
      restorePreviousAppearance: presentation?.previousProfile
        ? AVAILABLE
        : unavailable('selection-required'),
    } : allUnavailable('unknown')),
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
    async correctMemory(mutation) { return input.client.memory.correct({ agentHandle: handle, ...mutation }); },
    async forgetMemory(mutation) { return input.client.memory.forget({ agentHandle: handle, ...mutation }); },
    async setMemoryEnabled(enabled) { return input.client.memory.setEnabled({ agentHandle: handle, enabled }); },
    async deleteAllMemory(mutation) { return input.client.memory.deleteAll({ agentHandle: handle, ...mutation }); },
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
      return projectAppAppearanceWithHostPreview(presentation, voiceCatalog, input.hostMechanics);
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

function currentPresentationRevision(manager: ManagerSession | null): string {
  const revision = manager?.getSnapshot().state.appearance.presentationRevision;
  if (!revision) throw new Error('Agent Center Runtime presentation revision is unavailable.');
  return revision;
}

function assertHostAppearanceSelection(
  value: AgentCenterHostAppearanceSelection,
  expectedRole: 'avatar' | 'background',
): void {
  if (!value || typeof value !== 'object'
    || Object.keys(value).sort().join('|') !== 'importedAssets|intent'
    || !value.intent || typeof value.intent !== 'object'
    || !Array.isArray(value.importedAssets)
    || value.importedAssets.length === 0
    || value.importedAssets.some((asset) => asset.role !== expectedRole)) {
    throw new Error(`Agent Center Host ${expectedRole} selection is invalid.`);
  }
}

function projectHostPreviewEvidence(
  base: AgentCenterAppearanceProjection,
  evidence: AgentCenterHostCommittedPreviewEvidence,
): AgentCenterAppearanceProjection {
  if (evidence.tier !== 'avatar_preview_service'
    || !Array.isArray(evidence.warnings)
    || evidence.warnings.some((warning) => typeof warning !== 'string')) {
    throw new Error('Agent Center Host preview evidence is invalid.');
  }
  if (evidence.state === 'ready') {
    if (!isAvatarControlledPreviewSurfaceRef(evidence.previewImageRef)
      || !Number.isFinite(evidence.visiblePixels)
      || evidence.visiblePixels <= 0
      || evidence.nonPlaceholder !== true) {
      throw new Error('Agent Center Host ready preview evidence is invalid.');
    }
    return Object.freeze({
      ...base,
      renderState: 'ready',
      renderTier: evidence.tier,
      renderImageRef: evidence.previewImageRef,
      renderVisiblePixels: evidence.visiblePixels,
      renderFailureReason: null,
      renderUnavailableReasonCode: null,
      renderWarnings: Object.freeze([...evidence.warnings]),
    });
  }
  if ((evidence.state !== 'failed' && evidence.state !== 'unavailable')
    || evidence.previewImageRef !== null
    || evidence.visiblePixels !== null
    || evidence.nonPlaceholder !== false
    || !evidence.reason.trim()) {
    throw new Error('Agent Center Host non-ready preview evidence is invalid.');
  }
  return Object.freeze({
    ...base,
    renderState: evidence.state,
    renderTier: evidence.tier,
    renderImageRef: null,
    renderVisiblePixels: null,
    renderFailureReason: evidence.reason,
    renderUnavailableReasonCode: evidence.state === 'unavailable' ? 'renderer-unavailable' : null,
    renderWarnings: Object.freeze([...evidence.warnings]),
  });
}

async function projectAppAppearanceWithHostPreview(
  projection: NimiLocalAppAgentPresentationProjection,
  voiceCatalog: AgentCenterVoiceCatalogProjection | undefined,
  hostMechanics: AgentCenterHostMechanics | null | undefined,
): Promise<AgentCenterAppearanceProjection> {
  const base = projectAppAppearance(projection, voiceCatalog, Boolean(hostMechanics?.selectAvatar), Boolean(hostMechanics?.selectBackground));
  const profile = projection.profile;
  if (!hostMechanics?.resolveCommittedPreview
    || !profile?.avatarAssetRef
    || (profile.backendKind !== 'live2d' && profile.backendKind !== 'vrm')) {
    return base;
  }
  try {
    return projectHostPreviewEvidence(base, await hostMechanics.resolveCommittedPreview({
      backendKind: profile.backendKind,
      avatarAssetRef: profile.avatarAssetRef,
      presentationRevision: projection.presentationRevision,
    }));
  } catch (error) {
    return Object.freeze({
      ...base,
      renderState: 'unavailable',
      renderTier: 'avatar_preview_service',
      renderImageRef: null,
      renderVisiblePixels: null,
      renderFailureReason: error instanceof Error ? error.message : String(error),
      renderUnavailableReasonCode: 'renderer-unavailable',
    });
  }
}

function projectAppAppearance(
  projection: NimiLocalAppAgentPresentationProjection,
  voiceCatalog?: AgentCenterVoiceCatalogProjection,
  canSelectAvatar = false,
  canSelectBackground = false,
): AgentCenterAppearanceProjection {
  const profile = projection.profile;
  return Object.freeze({
    status: profile?.avatarAssetRef ? 'ready' : 'not_configured',
    presentationRevision: projection.presentationRevision,
    backendKind: profile?.backendKind ?? null,
    avatarAssetRef: profile?.avatarAssetRef || null,
    backgroundRef: profile?.backgroundAssetRef || null,
    defaultVoiceReference: profile?.defaultVoiceReference || projection.defaultVoiceReference || null,
    ...(voiceCatalog ? { voiceCatalog } : {}),
    avatarAutoplay: profile?.avatarAutoplay ?? projection.avatarAutoplay,
    previousSelection: projection.previousProfile
      ? projectAppPresentationIntent(projection.previousProfile)
      : null,
    avatarImportDisabled: !canSelectAvatar,
    backgroundImportDisabled: !canSelectBackground,
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

function appPresentationPatch(
  patch: AgentCenterPresentationIntent,
): NimiLocalAppAgentPresentationIntent {
  return Object.freeze({
    ...(patch.backendKind === undefined || patch.backendKind === null ? {} : { backendKind: patch.backendKind }),
    ...(patch.avatarAssetReference === undefined ? {} : {
      avatarAssetRef: nullablePresentationText(patch.avatarAssetReference),
    }),
    ...(patch.defaultVoiceReference === undefined ? {} : {
      defaultVoiceReference: nullablePresentationText(patch.defaultVoiceReference),
    }),
    ...(patch.avatarAutoplay === undefined ? {} : { avatarAutoplay: patch.avatarAutoplay }),
    ...(patch.backgroundAssetReference === undefined ? {} : {
      backgroundAssetRef: nullablePresentationText(patch.backgroundAssetReference),
    }),
  });
}

function nullablePresentationText(value: string | null): string {
  return value === null ? '' : value;
}

function appPresentationIntent(
  profile: NimiLocalAppAgentPresentationProfile,
): NimiLocalAppAgentPresentationIntent {
  return Object.freeze({
    ...(profile.backendKind ? { backendKind: profile.backendKind } : {}),
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
