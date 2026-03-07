import type {
  AuditStats,
  HookCallRecord,
  HookRegistration,
  HookSourceType,
  MissingDataCapabilityResolver,
  SpeechRouteResolver,
  TurnHookPoint,
} from './types.js';
import type {
  HookActionAuditFilter,
  HookActionAuditRecord,
  HookActionCommitRequest,
  HookActionCommitResult,
  HookActionDescriptorView,
  HookActionDiscoverFilter,
  HookActionDryRunRequest,
  HookActionRegistrationInput,
  HookActionRegistryChangeEvent,
  HookActionVerifyRequest,
  HookActionVerifyResult,
  HookActionResult,
} from './action.js';
import type { LocalAiProviderHints } from '../../local-ai-runtime/index.js';

export type HookLlmStreamEvent =
  | { type: 'text_delta'; textDelta: string }
  | { type: 'done' };

export type HookModAiDependencyEntry = {
  dependencyId: string;
  kind: 'model' | 'service' | 'node';
  capability?: string;
  required: boolean;
  selected: boolean;
  preferred: boolean;
  modelId?: string;
  repo?: string;
  engine?: string;
  serviceId?: string;
  nodeId?: string;
  reasonCode?: string;
  warnings: string[];
};

export type HookModAiDependencyRepairAction = {
  actionId: string;
  label: string;
  reasonCode: string;
  dependencyId?: string;
  capability?: string;
};

export type HookModAiDependencySnapshot = {
  modId: string;
  planId?: string;
  status: 'ready' | 'missing' | 'degraded';
  routeSource: 'local-runtime' | 'token-api' | 'mixed' | 'unknown';
  reasonCode?: string;
  warnings: string[];
  dependencies: HookModAiDependencyEntry[];
  repairActions: HookModAiDependencyRepairAction[];
  updatedAt: string;
};

export type HookModAiDependencySnapshotResolver = (input: {
  modId: string;
  capability?: string;
  routeSourceHint?: 'token-api' | 'local-runtime';
}) => Promise<HookModAiDependencySnapshot>;

export interface DesktopHookRuntimeFacade {
  setModSourceType(modId: string, sourceType: HookSourceType): void;
  getModSourceType(modId: string): HookSourceType;
  setCapabilityBaseline(modId: string, capabilities: string[]): void;
  clearCapabilityBaseline(modId: string): void;
  setGrantCapabilities(modId: string, capabilities: string[]): void;
  clearGrantCapabilities(modId: string): void;
  setDenialCapabilities(modId: string, capabilities: string[]): void;
  clearDenialCapabilities(modId: string): void;
  setSpeechRouteResolver(resolver: SpeechRouteResolver | null): void;
  setMissingDataCapabilityResolver(resolver: MissingDataCapabilityResolver | null): void;
  setModAiDependencySnapshotResolver(resolver: HookModAiDependencySnapshotResolver | null): void;
  getModAiDependencySnapshot(input: {
    modId: string;
    capability?: string;
    routeSourceHint?: 'token-api' | 'local-runtime';
  }): Promise<HookModAiDependencySnapshot>;
  suspendMod(modId: string): void;

  subscribeEvent(input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    handler: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
    once?: boolean;
  }): Promise<void>;
  unsubscribeEvent(input: { modId: string; topic?: string }): number;
  publishEvent(input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    payload: Record<string, unknown>;
  }): Promise<{ deliveredCount: number; failedCount: number; reasonCodes: string[] }>;
  listEventTopics(): string[];

  queryData(input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    query: Record<string, unknown>;
  }): Promise<unknown>;
  registerDataProvider(input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    handler: (query: Record<string, unknown>) => Promise<unknown> | unknown;
  }): Promise<void>;
  unregisterDataProvider(input: { modId: string; capability: string }): boolean;
  listDataCapabilities(): string[];
  registerDataCapability(
    capability: string,
    handler?: (query: Record<string, unknown>) => Promise<unknown> | unknown,
  ): void;

  registerTurnHookV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    point: TurnHookPoint;
    priority?: number;
    handler: (
      context: Record<string, unknown>,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  }): Promise<void>;
  unregisterTurnHook(input: { modId: string; point: TurnHookPoint }): number;
  invokeTurnHooks(input: {
    point: TurnHookPoint;
    context: Record<string, unknown>;
    abortSignal?: AbortSignal;
  }): Promise<{
    context: Record<string, unknown>;
    errors: Array<{ modId: string; point: TurnHookPoint; error: string }>;
    aborted: boolean;
  }>;

  registerUIExtensionV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    slot: string;
    priority?: number;
    extension: Record<string, unknown>;
  }): Promise<void>;
  unregisterUIExtension(input: { modId: string; slot?: string }): number;
  resolveUIExtensions(slot: string): Array<{
    modId: string;
    slot: string;
    priority: number;
    extension: Record<string, unknown>;
  }>;
  listUISlots(): string[];

  registerInterModHandlerV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    channel: string;
    handler: (
      payload: Record<string, unknown>,
      context?: Record<string, unknown>,
    ) => Promise<unknown> | unknown;
  }): Promise<void>;
  unregisterInterModHandler(input: { modId: string; channel?: string }): number;
  requestInterMod(input: {
    fromModId: string;
    sourceType?: HookSourceType;
    toModId: string;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<unknown>;
  broadcastInterMod(input: {
    fromModId: string;
    sourceType?: HookSourceType;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<{
    responses: Array<{ modId: string; result: unknown }>;
    errors: Array<{ modId: string; error: string }>;
  }>;
  discoverInterModChannels(): Array<{ channel: string; providers: string[] }>;

  generateModText(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    mode?: 'STORY' | 'SCENE_TURN';
    worldId?: string;
    agentId?: string;
    abortSignal?: AbortSignal;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
  }): Promise<{ text: string; promptTraceId: string; traceId: string }>;
  streamModText(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    mode?: 'STORY' | 'SCENE_TURN';
    worldId?: string;
    agentId?: string;
    abortSignal?: AbortSignal;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
  }): AsyncIterable<HookLlmStreamEvent>;
  generateModImage(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    model?: string;
    negativePrompt?: string;
    size?: string;
    aspectRatio?: string;
    quality?: string;
    style?: string;
    seed?: number;
    n?: number;
    referenceImages?: string[];
    mask?: string;
    responseFormat?: 'url' | 'base64';
    providerOptions?: Record<string, unknown>;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }): Promise<{ images: Array<{ uri?: string; b64Json?: string; mimeType?: string }>; traceId: string }>;
  generateModVideo(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    model?: string;
    negativePrompt?: string;
    durationSeconds?: number;
    fps?: number;
    resolution?: string;
    aspectRatio?: string;
    seed?: number;
    firstFrameUri?: string;
    lastFrameUri?: string;
    cameraMotion?: string;
    providerOptions?: Record<string, unknown>;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }): Promise<{ videos: Array<{ uri?: string; mimeType?: string }>; traceId: string }>;
  generateModEmbedding(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    input: string | string[];
    model?: string;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
  }): Promise<{ embeddings: number[][]; traceId: string }>;

  listSpeechProviders(input: {
    modId: string;
    sourceType?: HookSourceType;
  }): Promise<Array<{
    id: string;
    name: string;
    status: 'available' | 'unavailable';
    capabilities?: string[];
    voiceCount?: number;
    ownerModId?: string;
  }>>;
  listSpeechVoices(input: {
    modId: string;
    sourceType?: HookSourceType;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
  }): Promise<Array<{
    id: string;
    providerId: string;
    name: string;
    lang?: string;
    langs?: string[];
    sampleAudioUri?: string;
  }>>;
  synthesizeModSpeech(input: {
    modId: string;
    sourceType?: HookSourceType;
    text: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    voiceId: string;
    format?: 'mp3' | 'wav' | 'opus' | 'pcm';
    speakingRate?: number;
    pitch?: number;
    sampleRateHz?: number;
    language?: string;
    stylePrompt?: string;
    targetId?: string;
    sessionId?: string;
  }): Promise<{
    audioUri: string;
    mimeType: string;
    durationMs?: number;
    sampleRateHz?: number;
    traceId: string;
    providerTraceId?: string;
    cacheKey?: string;
  }>;
  openSpeechStream(input: {
    modId: string;
    sourceType?: HookSourceType;
    text: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    voiceId: string;
    format?: 'mp3' | 'wav' | 'opus' | 'pcm';
    sampleRateHz?: number;
    language?: string;
    stylePrompt?: string;
    targetId?: string;
    sessionId?: string;
  }): Promise<{
    streamId: string;
    eventTopic: string;
    format: 'mp3' | 'wav' | 'opus' | 'pcm';
    sampleRateHz: number;
    channels: number;
    providerTraceId?: string;
  }>;
  controlSpeechStream(input: {
    modId: string;
    sourceType?: HookSourceType;
    streamId: string;
    action: 'pause' | 'resume' | 'cancel';
  }): Promise<{ ok: boolean }>;
  closeSpeechStream(input: {
    modId: string;
    sourceType?: HookSourceType;
    streamId: string;
  }): Promise<{ ok: boolean }>;

  registerActionV1(input: HookActionRegistrationInput): HookActionDescriptorView;
  subscribeActionRegistryChanges(
    listener: (event: HookActionRegistryChangeEvent) => void,
  ): () => void;
  unregisterAction(input: { modId: string; actionId: string }): boolean;
  discoverActions(filter?: HookActionDiscoverFilter): HookActionDescriptorView[];
  dryRunAction(input: HookActionDryRunRequest): Promise<HookActionResult>;
  verifyAction(input: HookActionVerifyRequest): Promise<HookActionVerifyResult>;
  commitAction(input: HookActionCommitRequest): Promise<HookActionCommitResult>;
  queryActionAudit(filter?: HookActionAuditFilter): Promise<HookActionAuditRecord[]>;
  transcribeModSpeech(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    audioUri?: string;
    audioBase64?: string;
    mimeType?: string;
    language?: string;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
  }): Promise<{ text: string; traceId: string }>;

  getAudit(filter?: {
    modId?: string;
    hookType?: HookCallRecord['hookType'];
    target?: string;
    decision?: HookCallRecord['decision'];
    since?: string;
    limit?: number;
  }): HookCallRecord[];
  getAuditStats(modId?: string): AuditStats;
  listRegistrations(modId?: string): HookRegistration[];
  listModCapabilities(modId: string): string[];
  getPermissionDeclaration(modId: string): {
    sourceType: HookSourceType;
    baseline: string[];
    grants: string[];
    denials: string[];
  };
}
