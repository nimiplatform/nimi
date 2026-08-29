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
  AgentCenterAppManagerSnapshot,
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceProjection,
  AgentCenterHostAppearanceSelection,
  AgentCenterHostCommittedPreviewEvidence,
  AgentCenterHostMechanics,
  AgentCenterVoiceCatalogOption,
  AgentCenterVoiceCatalogProjection,
  AgentCenterVoiceCatalogSourceProjection,
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

const MEMORY_ITEM_WINDOW_LIMIT = 200;

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

function projectOwnerActionAvailability(
  manager: AgentCenterAppManagerSnapshot,
): AgentCenterActionAvailabilityProjection {
  return Object.freeze(Object.fromEntries(ACTIONS.map((action) => {
    const owner = manager.actionAvailability[action];
    if (owner.state === 'available') return [action, AVAILABLE];
    const reason: AgentCenterActionUnavailableReason = owner.reason === 'operation-unavailable'
      ? 'operation-unavailable'
      : owner.reason === 'owner-unavailable'
        ? 'owner-rejected'
        : 'selection-required';
    return [action, unavailable(reason)];
  }))) as AgentCenterActionAvailabilityProjection;
}

function applyMemorySelectionAvailability(
  availability: AgentCenterActionAvailabilityProjection,
  memory: AgentCenterMemoryProjection,
): AgentCenterActionAvailabilityProjection {
  const hasCurrentMemory = memory.items.some((item) => item.lifecycle === 'current');
  const hasAnyMemory = memory.currentCount + memory.supersededCount + memory.forgottenCount > 0;
  const demoteAvailable = (
    current: AgentCenterActionAvailability,
    selected: boolean,
  ): AgentCenterActionAvailability => selected || current.state === 'unavailable'
    ? current
    : unavailable('selection-required');
  return Object.freeze({
    ...availability,
    correctMemory: demoteAvailable(availability.correctMemory, hasCurrentMemory),
    forgetMemory: demoteAvailable(availability.forgetMemory, hasCurrentMemory),
    deleteAllMemory: demoteAvailable(availability.deleteAllMemory, hasAnyMemory),
  });
}

type SharedAIConfigRead = {
  readonly sharedAIConfig: AgentCenterSharedAIConfigProjection | null;
  readonly effectiveSelections: readonly ModelConfigEffectiveSelectionProjection[];
  readonly participation: readonly NimiSharedLocalAgentCapabilityParticipation[];
};

type SessionReadResult = {
  readonly state: AgentCenterStateInput;
  readonly availability: AgentCenterActionAvailabilityProjection;
  readonly errors: readonly string[];
};

type MutationRunResult<T> = {
  readonly result: T;
  readonly adopt: boolean;
};

interface SessionTransport {
  readonly appearanceAdapter: AgentCenterAppearanceAdapter | null;
  read(): Promise<SessionReadResult>;
  readSharedAIConfig(): Promise<SharedAIConfigRead>;
  overwriteSharedAIConfig(input: AgentCenterAIConfigMutation): Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
  listSharedAIConfigOptions(input: NimiSharedLocalAgentAIConfigOptionsQuery): Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
  updateAutonomy(input: AgentCenterAutonomyMutation): Promise<AgentCenterAutonomyProjection>;
  correctMemory(input: { readonly memoryId: string; readonly correctedContent: string }): Promise<AgentCenterMemoryMutationResult>;
  forgetMemory(input: { readonly memoryIds: readonly string[]; readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult>;
  setMemoryEnabled(enabled: boolean): Promise<AgentCenterMemoryMutationResult>;
  deleteAllMemory(input: { readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult>;
  loadMoreMemory(pageToken: string): Promise<AgentCenterMemoryProjection>;
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
  #lifecycleEpoch = 0;
  #refreshToken = 0;
  #mutationToken = 0;
  #stateVersion = 0;
  #memoryPageToken = 0;
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
      this.#requireAvailable('replaceAppearance');
      const mutation = await this.#runMutation('replaceAppearance', task);
      if (mutation.adopt) this.#replaceAppearance(mutation.result);
    };
    const appearance = transport.appearanceAdapter;
    this.appearance = Object.freeze({
      ...(appearance?.replaceAvatar ? { replaceAvatar: (kind: 'live2d' | 'vrm') => commitAppearance(() => appearance.replaceAvatar!(kind)) } : {}),
      ...(appearance?.importBackground ? { importBackground: () => commitAppearance(() => appearance.importBackground!()) } : {}),
      ...(appearance?.setDefaultVoice ? { setDefaultVoice: (reference: string) => commitAppearance(() => appearance.setDefaultVoice!(reference)) } : {}),
      ...(appearance?.setAvatarAutoplay ? { setAvatarAutoplay: (enabled: boolean) => commitAppearance(() => appearance.setAvatarAutoplay!(enabled)) } : {}),
    });
  }

  getSnapshot = (): AgentCenterSnapshot => this.#snapshot;

  invalidate = (): void => {
    if (this.#invalidated) return;
    this.#invalidated = true;
    this.#lifecycleEpoch += 1;
    this.#refreshToken += 1;
    this.#mutationToken += 1;
    this.#memoryPageToken += 1;
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
    const lifecycleEpoch = this.#lifecycleEpoch;
    const refreshToken = ++this.#refreshToken;
    this.#memoryPageToken += 1;
    const stateVersion = this.#stateVersion;
    this.#set({ ...this.#snapshot, phase: 'loading', error: null });
    try {
      const read = await this.transport.read();
      if (!this.#isCurrentRefresh(lifecycleEpoch, refreshToken, stateVersion)) return;
      this.#set({
        phase: read.errors.length > 0 ? 'degraded' : 'ready',
        state: stateWithAvailability(read.state, read.availability),
        availability: read.availability,
        error: read.errors[0] ?? null,
      });
    } catch (error) {
      if (!this.#isCurrentRefresh(lifecycleEpoch, refreshToken, stateVersion)) return;
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
    const mutation = await this.#runMutation(
      'overwriteSharedAIConfig',
      () => this.transport.overwriteSharedAIConfig(input),
    );
    const result = mutation.result;
    const sharedAIConfig = result.config
      ? projectAppSharedAIConfig(result.config, result.revision)
      : null;
    if (mutation.adopt) {
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
    }
    return result;
  }

  async #refreshSharedAIConfigEffectiveSelections(expectedRevision: string): Promise<void> {
    if (this.#invalidated) return;
    const lifecycleEpoch = this.#lifecycleEpoch;
    try {
      const refreshed = await this.transport.readSharedAIConfig();
      if (!this.#isLifecycleCurrent(lifecycleEpoch)) return;
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
    return this.transport.listSharedAIConfigOptions(input);
  }

  async updateAutonomy(input: AgentCenterAutonomyMutation): Promise<void> {
    this.#requireAvailable('updateAutonomy');
    const mutation = await this.#runMutation('updateAutonomy', () => this.transport.updateAutonomy(input));
    const autonomy = mutation.result;
    if (!mutation.adopt) return;
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

  async correctMemory(input: { readonly memoryId: string; readonly correctedContent: string }): Promise<AgentCenterMemoryMutationResult> {
    this.#requireAvailable('correctMemory');
    const mutation = await this.#runMutation('correctMemory', () => this.transport.correctMemory(input));
    if (mutation.adopt) {
      this.#replaceMemory(mutation.result.projection);
      await this.#refreshAfterCommittedMutation();
    }
    return mutation.result;
  }

  async forgetMemory(input: { readonly memoryIds: readonly string[]; readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult> {
    this.#requireAvailable('forgetMemory');
    const mutation = await this.#runMutation('forgetMemory', () => this.transport.forgetMemory(input));
    if (mutation.adopt) {
      this.#replaceMemory(mutation.result.projection);
      await this.#refreshAfterCommittedMutation();
    }
    return mutation.result;
  }

  async setMemoryEnabled(enabled: boolean): Promise<AgentCenterMemoryMutationResult> {
    this.#requireAvailable('switchMemory');
    const mutation = await this.#runMutation('switchMemory', () => this.transport.setMemoryEnabled(enabled));
    if (mutation.adopt) {
      this.#replaceMemory(mutation.result.projection);
      await this.#refreshAfterCommittedMutation();
    }
    return mutation.result;
  }

  async deleteAllMemory(input: { readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult> {
    this.#requireAvailable('deleteAllMemory');
    const mutation = await this.#runMutation('deleteAllMemory', () => this.transport.deleteAllMemory(input));
    if (mutation.adopt) {
      this.#replaceMemory(mutation.result.projection);
      await this.#refreshAfterCommittedMutation();
    }
    return mutation.result;
  }

  async loadMoreMemory(): Promise<AgentCenterMemoryProjection> {
    this.#requireAvailable('inspectMemory');
    const current = this.#snapshot.state.cognition.memory;
    if (!current?.nextPageToken) {
      if (!current) throw new Error('Agent Center Memory projection is unavailable.');
      return current;
    }
    const lifecycleEpoch = this.#lifecycleEpoch;
    const pageToken = ++this.#memoryPageToken;
    try {
      const page = await this.transport.loadMoreMemory(current.nextPageToken);
      if (!this.#isLifecycleCurrent(lifecycleEpoch) || this.#memoryPageToken !== pageToken) {
        return this.#snapshot.state.cognition.memory ?? page;
      }
      const byID = new Map(current.items.map((item) => [item.memoryId, item]));
      for (const item of page.items) byID.set(item.memoryId, item);
      const merged = Object.freeze({
        ...page,
        items: Object.freeze([...byID.values()].slice(-MEMORY_ITEM_WINDOW_LIMIT)),
      });
      this.#stateVersion += 1;
      this.#replaceMemory(merged);
      return merged;
    } catch (error) {
      if (this.#isLifecycleCurrent(lifecycleEpoch) && this.#memoryPageToken === pageToken) {
        this.#degradeAction('inspectMemory', error);
      }
      throw error;
    }
  }

  async replaceAppearance(input: AgentCenterPresentationCommitInput): Promise<void> {
    this.#requireAvailable('replaceAppearance');
    const mutation = await this.#runMutation('replaceAppearance', () => this.transport.replaceAppearance(input));
    const result = mutation.result;
    if (!mutation.adopt) return;
    if ('status' in result && !('runtimeStatus' in result) && !('agentAIConfig' in result)) {
      this.#replaceAppearance(result as AgentCenterAppearanceProjection);
    } else {
      this.#replaceState(result as AgentCenterState | AgentCenterStateInput);
    }
  }

  async restorePreviousAppearance(): Promise<void> {
    this.#requireAvailable('restorePreviousAppearance');
    const mutation = await this.#runMutation('restorePreviousAppearance', () => this.transport.restorePreviousAppearance());
    const result = mutation.result;
    if (!mutation.adopt) return;
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
    const availability = applyMemorySelectionAvailability(this.#snapshot.availability, projection);
    this.#set({
      ...this.#snapshot,
      phase: 'ready',
      availability,
      state: stateWithAvailability(replaceAgentCenterMemoryProjection(this.#snapshot.state, projection), availability),
      error: null,
    });
  }

  #set(snapshot: AgentCenterSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

  async #refreshAfterCommittedMutation(): Promise<void> {
    if (this.#invalidated) return;
    try {
      await this.refresh();
    } catch {
      // The owner mutation acknowledgement remains authoritative. A later
      // read failure cannot relabel the committed result as a mutation error.
    }
  }

  #assertActive(): void {
    if (this.#invalidated) {
      throw new Error('Agent Center session is invalidated; create a session for the current Agent handle.');
    }
  }

  #isLifecycleCurrent(lifecycleEpoch: number): boolean {
    return !this.#invalidated && this.#lifecycleEpoch === lifecycleEpoch;
  }

  #isCurrentRefresh(lifecycleEpoch: number, refreshToken: number, stateVersion: number): boolean {
    return this.#isLifecycleCurrent(lifecycleEpoch)
      && this.#refreshToken === refreshToken
      && this.#stateVersion === stateVersion;
  }

  async #runMutation<T>(action: AgentCenterProductAction, task: () => Promise<T>): Promise<MutationRunResult<T>> {
    this.#assertActive();
    const lifecycleEpoch = this.#lifecycleEpoch;
    const mutationToken = ++this.#mutationToken;
    try {
      const result = await task();
      const adopt = this.#isLifecycleCurrent(lifecycleEpoch) && this.#mutationToken === mutationToken;
      if (adopt) {
        this.#stateVersion += 1;
        this.#memoryPageToken += 1;
      }
      return {
        result,
        adopt,
      };
    } catch (error) {
      if (this.#isLifecycleCurrent(lifecycleEpoch) && this.#mutationToken === mutationToken) {
        this.#degradeAction(action, error);
      }
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
  const unavailableVoiceSource = (
    message: string,
    reason: AgentCenterActionUnavailableReason = 'operation-unavailable',
  ): AgentCenterVoiceCatalogSourceProjection => ({
    state: 'unavailable', reason, message, truncated: false,
  });
  const initialVoiceSources = Object.freeze({
    preset: unavailableVoiceSource('Runtime preset voice catalog has not been loaded.'),
    custom: unavailableVoiceSource('Runtime custom VoiceAsset catalog has not been loaded.'),
  });
  let voiceCatalog: AgentCenterVoiceCatalogProjection = {
    state: 'unavailable', sourceLabel: null, options: [], truncated: false,
    message: 'Runtime voice catalog has not been loaded.', sources: initialVoiceSources,
  };

  type VoiceCatalogRead = Readonly<{
    label: string;
    source: AgentCenterVoiceCatalogSourceProjection;
    options: readonly AgentCenterVoiceCatalogOption[];
  }>;

  const readPresetVoiceCatalog = async (): Promise<VoiceCatalogRead> => {
    try {
      const result = await input.client.sharedAIConfig.listOptions({ kind: 'preset-voices' });
      if (result.kind !== 'preset-voices') throw new Error('Shared LocalAgent preset voice options mismatch.');
      return {
        label: 'Shared LocalAgent preset voices',
        source: { state: 'ready', reason: null, message: null, truncated: result.truncated },
        options: result.options.map((voice) => ({
          reference: `preset_voice_id:${voice.voiceId}`,
          kind: 'preset_voice_id' as const,
          name: voice.name,
          supportedLangs: [...voice.supportedLangs],
        })),
      };
    } catch (error) {
      return {
        label: 'Shared LocalAgent preset voices', options: [],
        source: unavailableVoiceSource(errorMessage(error), unavailableReasonFromError(error)),
      };
    }
  };

  const readCustomVoiceCatalog = async (): Promise<VoiceCatalogRead> => {
    try {
      const result = await input.client.sharedAIConfig.listOptions({ kind: 'voice-assets' });
      if (result.kind !== 'voice-assets') throw new Error('Shared LocalAgent VoiceAsset options mismatch.');
      const options = result.options.map((asset) => ({
        reference: `voice_asset_id:${asset.voiceAssetId}` as const,
        kind: 'voice_asset_id' as const,
        name: asset.voiceAssetId,
        supportedLangs: [] as readonly string[],
      }));
      return {
        label: 'LocalApp custom VoiceAssets', options,
        source: { state: 'ready', reason: null, message: null, truncated: result.truncated },
      };
    } catch (error) {
      return {
        label: 'LocalApp custom VoiceAssets', options: [],
        source: unavailableVoiceSource(errorMessage(error), unavailableReasonFromError(error)),
      };
    }
  };

  const readVoiceCatalog = async (): Promise<AgentCenterVoiceCatalogProjection> => {
    const [preset, custom] = await Promise.all([readPresetVoiceCatalog(), readCustomVoiceCatalog()]);
    const sources = Object.freeze({ preset: preset.source, custom: custom.source });
    const seen = new Set<string>();
    const options = [...preset.options, ...custom.options].filter((option) => {
      if (seen.has(option.reference)) return false;
      seen.add(option.reference);
      return true;
    });
    const ready = [preset, custom].filter((entry) => entry.source.state === 'ready');
    const failures = [preset, custom]
      .filter((entry) => entry.source.state === 'unavailable')
      .map((entry) => entry.source.message);
    if (ready.length === 0) {
      return {
        state: 'unavailable', sourceLabel: null, options: [], truncated: false,
        message: failures.join('; ') || 'Runtime voice catalog is unavailable.', sources,
      };
    }
    return {
      state: 'ready', sourceLabel: ready.map((entry) => entry.label).join(' + '),
      options, truncated: ready.some((entry) => entry.source.truncated),
      message: failures.length > 0 ? failures.join('; ') : null, sources,
    };
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

  const read = async (): Promise<SessionReadResult> => {
    const [sharedRead, autonomyRead, presentationRead, voiceRead, memoryRead, managerRead] = await Promise.allSettled([
      readSharedAIConfig(),
      input.client.autonomy.snapshot({ agentHandle: handle }),
      input.client.presentation.snapshot({ agentHandle: handle }),
      readVoiceCatalog(),
      input.client.memory.inspect({ agentHandle: handle, limit: 100 }),
      input.client.manager.snapshot({
        agentHandle: handle,
        ...(input.conversationAnchorId ? { conversationAnchorId: input.conversationAnchorId } : {}),
      }),
    ]);
    const errors: string[] = [];
    const collectError = (label: string, result: PromiseSettledResult<unknown>): void => {
      if (result.status === 'rejected') errors.push(`${label}: ${errorMessage(result.reason)}`);
    };
    collectError('Shared AIConfig', sharedRead);
    collectError('Autonomy', autonomyRead);
    collectError('Presentation', presentationRead);
    collectError('Memory', memoryRead);
    collectError('Manager', managerRead);

    if (voiceRead.status === 'fulfilled') voiceCatalog = voiceRead.value;
    let appearance: AgentCenterAppearanceProjection | undefined;
    if (presentationRead.status === 'fulfilled') {
      presentation = presentationRead.value;
      appearance = await projectAppAppearanceWithHostPreview(
        presentationRead.value,
        voiceCatalog,
        input.hostMechanics,
      );
    } else {
      presentation = null;
    }

    const failedAvailability = (result: PromiseSettledResult<unknown>): AgentCenterActionAvailability => (
      result.status === 'rejected'
        ? unavailable(unavailableReasonFromError(result.reason))
        : unavailable('unknown')
    );
    let availability = managerRead.status === 'fulfilled'
      ? projectOwnerActionAvailability(managerRead.value)
      : allUnavailable(unavailableReasonFromError(managerRead.reason));
    if (sharedRead.status === 'rejected') {
      const failure = failedAvailability(sharedRead);
      availability = Object.freeze({
        ...availability,
        getSharedAIConfig: failure,
        overwriteSharedAIConfig: failure,
      });
    }
    if (autonomyRead.status === 'rejected') {
      const failure = failedAvailability(autonomyRead);
      availability = Object.freeze({
        ...availability,
        readAutonomy: failure,
        updateAutonomy: failure,
      });
    }
    if (presentationRead.status === 'rejected') {
      const failure = failedAvailability(presentationRead);
      availability = Object.freeze({
        ...availability,
        replaceAppearance: failure,
        restorePreviousAppearance: failure,
      });
    } else if (!presentationRead.value.previousProfile) {
      availability = Object.freeze({
        ...availability,
        restorePreviousAppearance: unavailable('selection-required'),
      });
    }
    if (memoryRead.status === 'rejected') {
      const failure = failedAvailability(memoryRead);
      availability = Object.freeze({
        ...availability,
        inspectMemory: failure,
        correctMemory: failure,
        forgetMemory: failure,
        switchMemory: failure,
        deleteAllMemory: failure,
      });
    } else {
      availability = applyMemorySelectionAvailability(availability, memoryRead.value);
    }

    return {
      state: {
        ...(sharedRead.status === 'fulfilled' ? {
          sharedAIConfig: sharedRead.value.sharedAIConfig,
          effectiveSelections: sharedRead.value.effectiveSelections,
          participation: sharedRead.value.participation,
        } : {}),
        ...(autonomyRead.status === 'fulfilled' ? { autonomy: projectAppAutonomy(autonomyRead.value) } : {}),
        ...(managerRead.status === 'fulfilled' ? { manager: managerRead.value } : {}),
        ...(appearance ? { appearance } : {}),
        ...(memoryRead.status === 'fulfilled' ? { cognitionMemory: memoryRead.value } : {}),
      },
      availability,
      errors: Object.freeze(errors),
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
        readVoiceCatalog(),
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

  const transport: SessionTransport = {
    appearanceAdapter,
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
    async loadMoreMemory(pageToken) {
      return input.client.memory.inspect({ agentHandle: handle, limit: 100, pageToken });
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
    expressionProfileRef: profile?.expressionProfileRef || null,
    idlePreset: profile?.idlePreset || null,
    interactionPolicyRef: profile?.interactionPolicyRef || null,
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
