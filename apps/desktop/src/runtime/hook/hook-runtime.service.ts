import { NimiSpeechEngine } from '../llm-adapter';
import type {
  DesktopHookRuntimeFacade,
  HookLlmStreamEvent,
  HookModAiDependencySnapshot,
  HookModAiDependencySnapshotResolver,
} from './contracts/facade.js';
import type {
  HookSourceType,
  MissingDataCapabilityResolver,
  SpeechRouteResolver,
  TurnHookPoint,
} from './contracts/types.js';
import { HookContractRegistry } from './contracts/contract-registry.js';
import { createHookError } from './contracts/errors.js';
import { DataApi } from './data-api/data-api.js';
import { EventBus } from './event-bus/event-bus.js';
import { InterModBroker } from './inter-mod/inter-mod.js';
import { PermissionGateway } from './permission/permission-gateway.js';
import { HookRegistry } from './registry/hook-registry.js';
import { HookAuditTrail } from './audit/hook-audit.js';
import { HookRuntimeDataService } from './services/data-service.js';
import { HookRuntimeEventService } from './services/event-service.js';
import { HookRuntimeInterModService } from './services/inter-mod-service.js';
import { HookRuntimeLifecycleService } from './services/lifecycle-service.js';
import { HookRuntimeLlmService } from './services/llm-service.js';
import { HookRuntimeMetaService } from './services/meta-service.js';
import { HookRuntimePermissionService } from './services/permission-service.js';
import { HookRuntimeSpeechService } from './services/speech-service.js';
import { HookRuntimeActionService } from './services/action-service.js';
import { HookRuntimeModAiDependencySnapshotService } from './services/mod-ai-dependency-snapshot-service.js';
import { HookActionSocialPreconditionService } from './services/action-social-precondition.js';
import { createCoreSocialFriendshipResolver } from './services/action-social-resolver.js';
import { HookRuntimeTurnService } from './services/turn-service.js';
import { HookRuntimeUiService } from './services/ui-service.js';
import { TurnHookOrchestrator } from './turn-hook/turn-hook.js';
import { UiExtensionGateway } from './ui-extension/ui-extension.js';
import { HookActionAuditSink } from './audit/action-audit-sink.js';
import { verifyExternalAgentExecutionContext } from '../runtime-store/tauri-bridge';
import type {
  HookActionAuditFilter,
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
} from './contracts/action.js';

export class DesktopHookRuntimeService implements DesktopHookRuntimeFacade {
  private readonly audit = new HookAuditTrail();
  private readonly registry = new HookRegistry();
  private readonly permissions = new PermissionGateway();
  private readonly eventBus = new EventBus();
  private readonly dataApi = new DataApi();
  private readonly interMod = new InterModBroker();
  private readonly uiExtension = new UiExtensionGateway();
  private readonly contracts = new HookContractRegistry();
  private readonly speechEngine = new NimiSpeechEngine({
    publish: async (topic, payload) => {
      this.eventBus.emit(topic, payload);
    },
  });
  private readonly turnHook = new TurnHookOrchestrator(this.registry);
  private readonly permissionService: HookRuntimePermissionService;
  private readonly eventService: HookRuntimeEventService;
  private readonly dataService: HookRuntimeDataService;
  private readonly turnService: HookRuntimeTurnService;
  private readonly uiService: HookRuntimeUiService;
  private readonly interModService: HookRuntimeInterModService;
  private readonly lifecycleService: HookRuntimeLifecycleService;
  private readonly llmService: HookRuntimeLlmService;
  private readonly speechService: HookRuntimeSpeechService;
  private readonly metaService: HookRuntimeMetaService;
  private readonly actionService: HookRuntimeActionService;
  private readonly modAiDependencySnapshotService = new HookRuntimeModAiDependencySnapshotService();
  private speechRouteResolver: SpeechRouteResolver | null = null;
  private missingDataCapabilityResolver: MissingDataCapabilityResolver | null = null;
  constructor() {
    this.permissions.setSourceType('core:runtime', 'core');
    this.permissions.setBaseline('core:runtime', ['*']);
    this.permissionService = new HookRuntimePermissionService({
      permissions: this.permissions,
      audit: this.audit,
    });
    const evaluatePermission = this.permissionService.evaluate.bind(this.permissionService);
    this.eventService = new HookRuntimeEventService({
      contracts: this.contracts,
      registry: this.registry,
      eventBus: this.eventBus,
      audit: this.audit,
      evaluatePermission,
    });
    this.dataService = new HookRuntimeDataService({
      contracts: this.contracts,
      registry: this.registry,
      dataApi: this.dataApi,
      audit: this.audit,
      evaluatePermission,
      getMissingDataCapabilityResolver: () => this.missingDataCapabilityResolver,
    });
    this.turnService = new HookRuntimeTurnService({
      contracts: this.contracts,
      registry: this.registry,
      turnHook: this.turnHook,
      audit: this.audit,
      evaluatePermission,
    });
    this.uiService = new HookRuntimeUiService({
      contracts: this.contracts,
      registry: this.registry,
      uiExtension: this.uiExtension,
      audit: this.audit,
      evaluatePermission,
    });
    this.interModService = new HookRuntimeInterModService({
      contracts: this.contracts,
      registry: this.registry,
      interMod: this.interMod,
      audit: this.audit,
      evaluatePermission,
    });
    this.lifecycleService = new HookRuntimeLifecycleService({
      registry: this.registry,
      eventBus: this.eventBus,
      interMod: this.interMod,
      uiExtension: this.uiExtension,
      permissions: this.permissions,
    });
    this.llmService = new HookRuntimeLlmService({
      audit: this.audit,
      evaluatePermission,
    });
    this.speechService = new HookRuntimeSpeechService({
      speechEngine: this.speechEngine,
      audit: this.audit,
      evaluatePermission,
      resolveRoute: async ({ modId, providerId, routeSource, connectorId, model }) => {
        if (!this.speechRouteResolver) {
          throw createHookError(
            'HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE',
            'speech route resolver unavailable',
            { modId, providerId: providerId || null },
          );
        }
        return this.speechRouteResolver({ modId, providerId, routeSource, connectorId, model });
      },
      ensureEventTopic: (topic) => {
        this.contracts.ensureEventTopic(topic);
      },
    });
    this.metaService = new HookRuntimeMetaService({
      audit: this.audit,
      registry: this.registry,
      permissions: this.permissions,
    });
    const socialPreconditionService = new HookActionSocialPreconditionService(
      createCoreSocialFriendshipResolver({
        queryData: ({ capability, humanAccountId }) => this.dataService.queryData({
          modId: 'core:runtime',
          sourceType: 'core',
          capability,
          query: {
            accountId: humanAccountId,
            subjectAccountId: humanAccountId,
            limit: 500,
          },
        }),
      }),
    );
    this.actionService = new HookRuntimeActionService({
      evaluatePermission,
      auditSink: new HookActionAuditSink(),
      socialPreconditionService,
      verifyExternalAgentContext: async (input) => verifyExternalAgentExecutionContext(input),
    });
  }
  setModSourceType(modId: string, sourceType: HookSourceType): void { this.lifecycleService.setModSourceType(modId, sourceType); }
  getModSourceType(modId: string): HookSourceType { return this.lifecycleService.getModSourceType(modId); }
  setCapabilityBaseline(modId: string, capabilities: string[]): void { this.lifecycleService.setCapabilityBaseline(modId, capabilities); }
  clearCapabilityBaseline(modId: string): void { this.lifecycleService.clearCapabilityBaseline(modId); }
  setGrantCapabilities(modId: string, capabilities: string[]): void { this.lifecycleService.setGrantCapabilities(modId, capabilities); }
  clearGrantCapabilities(modId: string): void { this.lifecycleService.clearGrantCapabilities(modId); }
  setDenialCapabilities(modId: string, capabilities: string[]): void { this.lifecycleService.setDenialCapabilities(modId, capabilities); }
  clearDenialCapabilities(modId: string): void { this.lifecycleService.clearDenialCapabilities(modId); }
  setSpeechFetchImpl(fn: typeof fetch): void { this.speechEngine.setFetchImpl(fn); }
  setSpeechRouteResolver(resolver: SpeechRouteResolver | null): void { this.speechRouteResolver = resolver; }
  setMissingDataCapabilityResolver(resolver: MissingDataCapabilityResolver | null): void { this.missingDataCapabilityResolver = resolver; }
  setModAiDependencySnapshotResolver(resolver: HookModAiDependencySnapshotResolver | null): void { this.modAiDependencySnapshotService.setResolver(resolver); }
  getModAiDependencySnapshot(input: { modId: string; capability?: string; routeSourceHint?: 'token-api' | 'local-runtime'; }): Promise<HookModAiDependencySnapshot> {
    return this.modAiDependencySnapshotService.getSnapshot(input);
  }
  suspendMod(modId: string): void { this.lifecycleService.suspendMod(modId); }
  subscribeEvent(input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    handler: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
    once?: boolean;
  }): Promise<void> {
    return this.eventService.subscribeEvent(input);
  }
  unsubscribeEvent(input: { modId: string; topic?: string }): number {
    return this.eventService.unsubscribeEvent(input);
  }
  publishEvent(input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    payload: Record<string, unknown>;
  }): Promise<{ deliveredCount: number; failedCount: number; reasonCodes: string[] }> {
    return this.eventService.publishEvent(input);
  }
  listEventTopics(): string[] {
    return this.eventService.listEventTopics();
  }
  queryData(input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    query: Record<string, unknown>;
  }): Promise<unknown> {
    return this.dataService.queryData(input);
  }
  registerDataProvider(input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    handler: (query: Record<string, unknown>) => Promise<unknown> | unknown;
  }): Promise<void> {
    return this.dataService.registerDataProvider(input);
  }
  unregisterDataProvider(input: { modId: string; capability: string }): boolean {
    return this.dataService.unregisterDataProvider(input);
  }
  listDataCapabilities(): string[] {
    return this.dataService.listDataCapabilities();
  }
  registerDataCapability(
    capability: string,
    handler?: (query: Record<string, unknown>) => Promise<unknown> | unknown,
  ): void {
    this.dataService.registerDataCapability(capability, handler);
  }
  registerTurnHookV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    point: TurnHookPoint;
    priority?: number;
    handler: (context: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  }): Promise<void> {
    return this.turnService.registerTurnHookV2(input);
  }
  unregisterTurnHook(input: { modId: string; point: TurnHookPoint }): number {
    return this.turnService.unregisterTurnHook(input);
  }
  invokeTurnHooks(input: {
    point: TurnHookPoint;
    context: Record<string, unknown>;
    abortSignal?: AbortSignal;
  }): Promise<{
    context: Record<string, unknown>;
    errors: Array<{ modId: string; point: TurnHookPoint; error: string }>;
    aborted: boolean;
  }> {
    return this.turnService.invokeTurnHooks(input);
  }
  registerUIExtensionV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    slot: string;
    priority?: number;
    extension: Record<string, unknown>;
  }): Promise<void> {
    return this.uiService.registerUIExtensionV2(input);
  }
  unregisterUIExtension(input: { modId: string; slot?: string }): number {
    return this.uiService.unregisterUIExtension(input);
  }
  resolveUIExtensions(slot: string): Array<{
    modId: string;
    slot: string;
    priority: number;
    extension: Record<string, unknown>;
  }> {
    return this.uiService.resolveUIExtensions(slot);
  }
  listUISlots(): string[] {
    return this.uiService.listUISlots();
  }
  registerInterModHandlerV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    channel: string;
    handler: (payload: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown> | unknown;
  }): Promise<void> {
    return this.interModService.registerInterModHandlerV2(input);
  }
  unregisterInterModHandler(input: { modId: string; channel?: string }): number {
    return this.interModService.unregisterInterModHandler(input);
  }
  requestInterMod(input: {
    fromModId: string;
    sourceType?: HookSourceType;
    toModId: string;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.interModService.requestInterMod(input);
  }
  broadcastInterMod(input: {
    fromModId: string;
    sourceType?: HookSourceType;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<{
    responses: Array<{ modId: string; result: unknown }>;
    errors: Array<{ modId: string; error: string }>;
  }> {
    return this.interModService.broadcastInterMod(input);
  }
  discoverInterModChannels(): Array<{ channel: string; providers: string[] }> {
    return this.interModService.discoverInterModChannels();
  }
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
  }): Promise<{ text: string; promptTraceId: string; traceId: string }> {
    return this.llmService.generateModText(input);
  }
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
  }): AsyncIterable<HookLlmStreamEvent> {
    return this.llmService.streamModText(input);
  }
  generateModImage(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    negativePrompt?: string;
    model?: string;
    size?: string;
    aspectRatio?: string;
    quality?: string;
    style?: string;
    seed?: number;
    n?: number;
    referenceImages?: string[];
    mask?: string;
    responseFormat?: 'url' | 'base64';
    extensions?: Record<string, unknown>;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
  }): Promise<{ images: Array<{ uri?: string; b64Json?: string; mimeType?: string }>; traceId: string }> {
    return this.llmService.generateModImage(input);
  }
  generateModVideo(input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
    prompt?: string;
    negativePrompt?: string;
    model?: string;
    content: Array<
      | {
        type: 'text';
        role?: 'prompt';
        text: string;
      }
      | {
        type: 'image_url';
        role: 'first_frame' | 'last_frame' | 'reference_image';
        imageUrl: string;
      }
    >;
    options?: {
      resolution?: string;
      ratio?: string;
      durationSec?: number;
      frames?: number;
      fps?: number;
      seed?: number;
      cameraFixed?: boolean;
      watermark?: boolean;
      generateAudio?: boolean;
      draft?: boolean;
      serviceTier?: string;
      executionExpiresAfterSec?: number;
      returnLastFrame?: boolean;
    };
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
  }): Promise<{ videos: Array<{ uri?: string; mimeType?: string }>; traceId: string }> {
    return this.llmService.generateModVideo(input);
  }
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
  }): Promise<{ embeddings: number[][]; traceId: string }> {
    return this.llmService.generateModEmbedding(input);
  }
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
  }>> {
    return this.speechService.listSpeechProviders(input);
  }
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
    modelResolved?: string;
    voiceCatalogSource?: string;
    voiceCatalogVersion?: string;
  }>> {
    return this.speechService.listSpeechVoices(input);
  }
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
  }> {
    return this.speechService.synthesizeModSpeech(input);
  }
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
  }> {
    return this.speechService.openSpeechStream(input);
  }
  controlSpeechStream(input: {
    modId: string;
    sourceType?: HookSourceType;
    streamId: string;
    action: 'pause' | 'resume' | 'cancel';
  }): Promise<{ ok: boolean }> {
    return this.speechService.controlSpeechStream(input);
  }
  closeSpeechStream(input: {
    modId: string;
    sourceType?: HookSourceType;
    streamId: string;
  }): Promise<{ ok: boolean }> {
    return this.speechService.closeSpeechStream(input);
  }
  registerActionV1(input: HookActionRegistrationInput): HookActionDescriptorView { return this.actionService.registerActionV1(input); }
  subscribeActionRegistryChanges(listener: (event: HookActionRegistryChangeEvent) => void): () => void {
    return this.actionService.subscribeActionRegistryChanges(listener);
  }
  unregisterAction(input: { modId: string; actionId: string }): boolean { return this.actionService.unregisterAction(input); }
  discoverActions(filter?: HookActionDiscoverFilter): HookActionDescriptorView[] { return this.actionService.discoverActions(filter); }
  dryRunAction(input: HookActionDryRunRequest): Promise<HookActionResult> { return this.actionService.dryRunAction(input); }
  verifyAction(input: HookActionVerifyRequest): Promise<HookActionVerifyResult> { return this.actionService.verifyAction(input); }
  commitAction(input: HookActionCommitRequest): Promise<HookActionCommitResult> { return this.actionService.commitAction(input); }
  queryActionAudit(filter?: HookActionAuditFilter) { return this.actionService.queryActionAudit(filter); }
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
  }): Promise<{ text: string; traceId: string }> {
    return this.llmService.transcribeModSpeech(input);
  }
  getAudit(filter?: {
    modId?: string;
    hookType?: 'event-bus' | 'data-api' | 'ui-extension' | 'turn-hook' | 'inter-mod' | 'llm' | 'action';
    target?: string;
    decision?: 'ALLOW' | 'ALLOW_WITH_WARNING' | 'DENY';
    since?: string;
    limit?: number;
  }) {
    return this.metaService.getAudit(filter);
  }
  getAuditStats(modId?: string) {
    return this.metaService.getAuditStats(modId);
  }
  listRegistrations(modId?: string) {
    return this.metaService.listRegistrations(modId);
  }
  listModCapabilities(modId: string): string[] {
    return this.metaService.listModCapabilities(modId);
  }
  getPermissionDeclaration(modId: string): {
    sourceType: HookSourceType;
    baseline: string[];
    grants: string[];
    denials: string[];
  } {
    return this.metaService.getPermissionDeclaration(modId);
  }
}
