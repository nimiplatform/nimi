import type {
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentMemoryObservatorySnapshot,
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentTurnContextSummary,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  RouteConnector,
  RouteConnectorModel,
  RouteLocalModel,
  RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker/headless';
import { buildAgentCenterState } from './state.js';
import type {
  AgentCenterActionAvailability,
  AgentCenterActionAvailabilityProjection,
  AgentCenterActionUnavailableReason,
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceProjection,
  AgentCenterAutonomyMutationInput,
  AgentCenterAutonomyProjection,
  AgentCenterNextStepAction,
  AgentCenterOpaqueHandle,
  AgentCenterAIConfigModule,
  AgentCenterPermissionedAutonomyMutation,
  AgentCenterPermissionedAIConfigMutation,
  AgentCenterPermissionedPresentationCommitInput,
  AgentCenterPermissionedSdkSurface,
  AgentCenterPermissionedSdkSurfaceInput,
  AgentCenterProductAction,
  AgentCenterRuntimeLoadInput,
  AgentCenterRuntimeModelConfigAdapter,
  AgentCenterRuntimeAIConfigProjection,
  AgentCenterSession,
  AgentCenterSnapshot,
  AgentCenterState,
  AgentCenterStateInput,
  AgentCenterTransportActionProjection,
} from './types.js';

const ACTIONS: readonly AgentCenterProductAction[] = [
  'readAIConfig',
  'updateAIConfig',
  'readAutonomy',
  'updateAutonomy',
  'readMemorySummary',
  'replaceAppearance',
  'restorePreviousAppearance',
  'requestPermission',
  'openPermissionSettings',
];

const AVAILABLE: AgentCenterActionAvailability = Object.freeze({
  state: 'available', reason: null, nextStep: null,
});

function nextStep(reason: AgentCenterActionUnavailableReason): AgentCenterNextStepAction {
  switch (reason) {
    case 'needs-grant':
    case 'denied':
    case 'revoked': return 'requestPermission';
    case 'request-pending':
    case 'reserved-not-admitted': return 'wait';
    case 'runtime-offline':
    case 'unknown': return 'retry';
  }
}

function unavailable(reason: AgentCenterActionUnavailableReason): AgentCenterActionAvailability {
  return Object.freeze({ state: 'unavailable', reason, nextStep: nextStep(reason) });
}

function allAvailable(): AgentCenterActionAvailabilityProjection {
  return Object.freeze(Object.fromEntries(ACTIONS.map((action) => [action, AVAILABLE]))) as AgentCenterActionAvailabilityProjection;
}

function allUnavailable(reason: AgentCenterActionUnavailableReason): AgentCenterActionAvailabilityProjection {
  return Object.freeze(Object.fromEntries(ACTIONS.map((action) => [action, unavailable(reason)]))) as AgentCenterActionAvailabilityProjection;
}

const TRANSPORT_REASON_MAP = {
  reserved_not_admitted: 'reserved-not-admitted',
  unknown: 'unknown',
  not_granted: 'needs-grant',
  request_pending: 'request-pending',
  grant_denied: 'denied',
  grant_revoked: 'revoked',
  runtime_offline: 'runtime-offline',
} as const satisfies Record<string, AgentCenterActionUnavailableReason>;

export function projectAgentCenterActionAvailability(
  projection: AgentCenterTransportActionProjection,
): AgentCenterActionAvailabilityProjection {
  return Object.freeze(Object.fromEntries(ACTIONS.map((action) => {
    const entry = projection[action];
    if (entry.state === 'available') return [action, AVAILABLE];
    const reason = entry.reason ? TRANSPORT_REASON_MAP[entry.reason] : 'unknown';
    return [action, unavailable(reason)];
  }))) as AgentCenterActionAvailabilityProjection;
}

interface SessionTransport {
  readonly modelConfig: AgentCenterRuntimeModelConfigAdapter | null;
  readonly appearanceAdapter: AgentCenterAppearanceAdapter | null;
  actionAvailability(): Promise<AgentCenterActionAvailabilityProjection>;
  read(): Promise<AgentCenterStateInput>;
  updateAIConfig(input: AgentCenterPermissionedAIConfigMutation): Promise<AgentCenterStateInput | AgentCenterState>;
  updateAutonomy(input: AgentCenterPermissionedAutonomyMutation): Promise<AgentCenterStateInput | AgentCenterState>;
  replaceAppearance(input: AgentCenterPermissionedPresentationCommitInput): Promise<AgentCenterStateInput | AgentCenterState | AgentCenterAppearanceProjection>;
  restorePreviousAppearance(): Promise<AgentCenterStateInput | AgentCenterState | AgentCenterAppearanceProjection>;
  requestPermission(): Promise<void>;
  openPermissionSettings(): Promise<void>;
  subscribeReadiness?(): AsyncIterable<AgentCenterStateInput>;
  subscribeActionPosture?(
    listener: (availability: AgentCenterActionAvailabilityProjection) => void,
  ): () => void;
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
  const modelAvailable = availability.updateAIConfig.state === 'available';
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

class ManagerSession {
  readonly modelConfig: AgentCenterRuntimeModelConfigAdapter | null;
  readonly appearance: AgentCenterSession['appearance'];
  #snapshot: AgentCenterSnapshot;
  #listeners = new Set<() => void>();
  #iterator: AsyncIterator<AgentCenterStateInput> | null = null;
  #actionPostureUnsubscribe: (() => void) | null = null;

  constructor(private readonly transport: SessionTransport) {
    this.modelConfig = transport.modelConfig;
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
      ...(appearance?.setAvatarAutoplay ? { setAvatarAutoplay: (enabled: boolean) => commitAppearance(() => appearance.setAvatarAutoplay!(enabled)) } : {}),
    });
  }

  getSnapshot = (): AgentCenterSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      void this.refresh();
      this.#startReadiness();
      this.#startActionPosture();
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        const iterator = this.#iterator;
        this.#iterator = null;
        void iterator?.return?.();
        this.#actionPostureUnsubscribe?.();
        this.#actionPostureUnsubscribe = null;
      }
    };
  };

  async refresh(): Promise<void> {
    this.#set({ ...this.#snapshot, phase: 'loading', error: null });
    try {
      const availability = await this.transport.actionAvailability();
      const state = await this.transport.read();
      this.#set({ phase: 'ready', state: stateWithAvailability(state, availability), availability, error: null });
    } catch (error) {
      const availability = allUnavailable('runtime-offline');
      this.#set({
        phase: 'degraded',
        state: stateWithAvailability(this.#snapshot.state, availability),
        availability,
        error: errorMessage(error),
      });
    }
  }

  async updateAIConfig(input: AgentCenterPermissionedAIConfigMutation): Promise<void> {
    this.#requireAvailable('updateAIConfig');
    const result = await this.transport.updateAIConfig(input);
    this.#replaceState(result);
  }

  async updateAutonomy(input: AgentCenterPermissionedAutonomyMutation): Promise<void> {
    this.#requireAvailable('updateAutonomy');
    const result = await this.transport.updateAutonomy(input);
    this.#replaceState(result);
  }

  async replaceAppearance(input: AgentCenterPermissionedPresentationCommitInput): Promise<void> {
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

  async requestPermission(): Promise<void> {
    this.#requireAvailable('requestPermission');
    await this.transport.requestPermission();
    await this.refresh();
  }

  async openPermissionSettings(): Promise<void> {
    this.#requireAvailable('openPermissionSettings');
    await this.transport.openPermissionSettings();
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

  #startActionPosture(): void {
    if (!this.transport.subscribeActionPosture || this.#actionPostureUnsubscribe) return;
    this.#actionPostureUnsubscribe = this.transport.subscribeActionPosture((availability) => {
      const becameReadable = this.#snapshot.availability.readAIConfig.state === 'unavailable'
        && availability.readAIConfig.state === 'available';
      this.#set({
        ...this.#snapshot,
        phase: this.#snapshot.phase === 'loading' ? 'loading' : 'ready',
        state: stateWithAvailability(this.#snapshot.state, availability),
        availability,
        error: null,
      });
      if (becameReadable) void this.refresh();
    });
  }

  #startReadiness(): void {
    if (!this.transport.subscribeReadiness || this.#iterator) return;
    const iterator = this.transport.subscribeReadiness()[Symbol.asyncIterator]();
    this.#iterator = iterator;
    void (async () => {
      try {
        while (this.#iterator === iterator) {
          const next = await iterator.next();
          if (next.done || this.#iterator !== iterator) break;
          this.#replaceState(next.value);
        }
      } catch (error) {
        if (this.#iterator === iterator) {
          this.#set({ ...this.#snapshot, phase: 'degraded', error: errorMessage(error) });
        }
      } finally {
        if (this.#iterator === iterator) this.#iterator = null;
      }
    })();
  }
}

export interface CreateFirstPartyAgentCenterSessionInput {
  readonly aiConfig: AgentCenterAIConfigModule;
  readonly inspect?: NimiRuntimeAgentInspectSurface | null;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly modelConfig?: AgentCenterRuntimeModelConfigAdapter | null;
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

export function createFirstPartyAgentCenterSession(
  input: CreateFirstPartyAgentCenterSessionInput,
): AgentCenterSession {
  const identity = input.loadInput?.identity || input.identity;
  const callInput = { ...identity, subjectUserId: input.loadInput?.subjectUserId };
  const read = async (): Promise<AgentCenterStateInput> => {
    const [aiConfig, autonomy, inspect, memory, sourceContextStatus, turnContextSummary, appearance] = await Promise.all([
      input.aiConfig.snapshot(callInput),
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
    return { aiConfig, autonomy, inspect, memory, sourceContextStatus, turnContextSummary, appearance };
  };
  const transport: SessionTransport = {
    modelConfig: input.modelConfig || null,
    appearanceAdapter: input.appearance || null,
    actionAvailability: async () => allAvailable(),
    read,
    async updateAIConfig(mutation) {
      const aiConfig = await input.aiConfig.update({
        ...identity,
        subjectUserId: input.loadInput?.subjectUserId,
        expectedConfigurationRevision: mutation.expectedConfigurationRevision,
        config: mutation.config,
      });
      return { ...(await read()), aiConfig };
    },
    async updateAutonomy(mutation) {
      if (!input.autonomy) throw new Error('Agent Center autonomy transport is unavailable.');
      const autonomy = await input.autonomy.update(identity, mutation);
      return { ...(await read()), autonomy };
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
    async requestPermission() {},
    async openPermissionSettings() {},
  };
  return new ManagerSession(transport) as unknown as AgentCenterSession;
}

export function sealAgentCenterPermissionedSdkSurface(
  input: AgentCenterPermissionedSdkSurfaceInput,
): AgentCenterPermissionedSdkSurface {
  return Object.freeze(input) as AgentCenterPermissionedSdkSurface;
}

export interface CreatePermissionedAgentCenterSessionInput {
  readonly handle: AgentCenterOpaqueHandle;
  readonly surface: AgentCenterPermissionedSdkSurface;
  readonly loadOptions?: { readonly conversationAnchor?: string };
}

function createPermissionedModelConfigAdapter(
  loadProjection: () => Promise<AgentCenterRuntimeAIConfigProjection | null>,
  profile: AgentCenterRuntimeModelConfigAdapter['aiProfile'],
): AgentCenterRuntimeModelConfigAdapter {
  const providers = new Map<string, RouteModelPickerDataProvider>();
  const optionsFor = async (capability: string) => {
    const projection = await loadProjection();
    if (!projection) {
      throw new Error('Agent Center model route options are unavailable.');
    }
    return (projection.routeOptions || []).filter((option) => option.capability === capability);
  };
  return Object.freeze({
    aiProfile: profile,
    providerResolver(routeCapability: string): RouteModelPickerDataProvider | null {
      const capability = String(routeCapability || '').trim();
      if (!capability) return null;
      const existing = providers.get(capability);
      if (existing) return existing;
      const provider: RouteModelPickerDataProvider = {
        async listLocalModels(): Promise<RouteLocalModel[]> {
          return (await optionsFor(capability))
            .filter((option) => option.routePolicy === 'local')
            .map((option) => ({
              localModelId: option.model,
              modelId: option.model,
              label: option.label,
              engine: 'local',
              status: option.availability === 'ready' ? 'active' : 'installed',
              capabilities: [option.capability],
            }));
        },
        async listConnectors(): Promise<RouteConnector[]> {
          const byProvider = new Map<string, RouteConnector>();
          for (const option of await optionsFor(capability)) {
            if (option.routePolicy !== 'cloud' || !option.provider || byProvider.has(option.provider)) continue;
            byProvider.set(option.provider, {
              connectorId: option.provider,
              provider: option.provider,
              label: option.provider,
              status: option.availability,
            });
          }
          return [...byProvider.values()];
        },
        async listConnectorModels(connectorId: string): Promise<RouteConnectorModel[]> {
          return (await optionsFor(capability))
            .filter((option) => option.routePolicy === 'cloud' && option.provider === connectorId)
            .map((option) => ({
              modelId: option.model,
              remoteModelCatalogId: option.model,
              providerModelId: option.model,
              provider: option.provider,
              modelLabel: option.label,
              available: true,
              capabilities: [option.capability],
            }));
        },
      };
      providers.set(capability, provider);
      return provider;
    },
  });
}

export function createPermissionedAgentCenterSession(
  input: CreatePermissionedAgentCenterSessionInput,
): AgentCenterSession {
  if (!String(input.handle).trim()) throw new Error('Agent Center requires an opaque Agent handle.');
  let manager: ManagerSession | null = null;
  const appearanceFromState = (value: AgentCenterStateInput | AgentCenterState): AgentCenterAppearanceProjection => (
    isBuiltState(value) ? value : buildAgentCenterState(value)
  ).appearance;
  const appearanceAdapter: AgentCenterAppearanceAdapter = {
    async load() {
      return appearanceFromState(await input.surface.read(input.handle, input.loadOptions));
    },
    async setAvatarAutoplay(enabled) {
      const current = manager?.getSnapshot().state.appearance;
      const expectedRevision = current?.presentationRevision;
      if (expectedRevision === null || expectedRevision === undefined) {
        throw new Error('Agent Center Runtime presentation revision is unavailable.');
      }
      const result = await input.surface.replaceAppearance(input.handle, {
        expectedRevision,
        intent: { avatarAutoplay: enabled },
        importedAssets: [],
      });
      if ('status' in result && !('runtimeStatus' in result) && !('agentAIConfig' in result)) {
        return result as AgentCenterAppearanceProjection;
      }
      return appearanceFromState(result as AgentCenterStateInput | AgentCenterState);
    },
  };
  const transport: SessionTransport = {
    modelConfig: createPermissionedModelConfigAdapter(async () => {
      const current = manager?.getSnapshot().state.aiConfig;
      if (current) return current;
      const state = await input.surface.read(input.handle, input.loadOptions);
      return state.aiConfig || null;
    }, {
      list: async () => [...await input.surface.listAIProfiles(input.handle)],
      previewApply: (scopeRef, profileId, options) => (
        input.surface.previewAIProfile(input.handle, scopeRef, profileId, options)
      ),
      apply: (scopeRef, profileId, options) => (
        input.surface.applyAIProfile(input.handle, scopeRef, profileId, options)
      ),
    }),
    appearanceAdapter,
    async actionAvailability() {
      return projectAgentCenterActionAvailability(await input.surface.actionPosture(input.handle));
    },
    read: () => input.surface.read(input.handle, input.loadOptions),
    updateAIConfig: (mutation) => input.surface.updateConfiguration(input.handle, mutation),
    updateAutonomy: (mutation) => input.surface.updateAutonomy(input.handle, mutation),
    replaceAppearance: (mutation) => input.surface.replaceAppearance(input.handle, mutation),
    restorePreviousAppearance: () => input.surface.restorePreviousAppearance(input.handle),
    requestPermission: async () => { await input.surface.requestPermission?.(input.handle); },
    openPermissionSettings: async () => { await input.surface.openPermissionSettings?.(input.handle); },
    ...(input.surface.subscribeReadiness ? {
      subscribeReadiness: () => input.surface.subscribeReadiness!(input.handle),
    } : {}),
    ...(input.surface.subscribeActionPosture ? {
      subscribeActionPosture: (listener: (availability: AgentCenterActionAvailabilityProjection) => void) => (
        input.surface.subscribeActionPosture!(input.handle, (projection) => {
          listener(projectAgentCenterActionAvailability(projection));
        })
      ),
    } : {}),
  };
  manager = new ManagerSession(transport);
  return manager as unknown as AgentCenterSession;
}
