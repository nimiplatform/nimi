import type { DesktopHookRuntimeFacade, HookModLocalProfileSnapshot, HookModLocalProfileSnapshotResolver, } from './contracts/facade.js';
import type { AgentProfileReadFilterInput, AgentProfileReadFilterResult, HookType, HookSourceType, MissingDataCapabilityResolver, TurnHookPoint, } from './contracts/types.js';
import { HookContractRegistry } from './contracts/contract-registry.js';
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
import { HookRuntimeMetaService } from './services/meta-service.js';
import { HookRuntimePermissionService } from './services/permission-service.js';
import { HookRuntimeActionService } from './services/action-service.js';
import { HookRuntimeModLocalProfileSnapshotService } from './services/mod-local-profile-snapshot-service.js';
import { HookActionSocialPreconditionService } from './services/action-social-precondition.js';
import { createCoreSocialFriendshipResolver } from './services/action-social-resolver.js';
import { HookRuntimeStorageService } from './services/storage-service.js';
import { HookRuntimeTurnService } from './services/turn-service.js';
import { HookRuntimeUiService } from './services/ui-service.js';
import { TurnHookOrchestrator } from './turn-hook/turn-hook.js';
import { UiExtensionGateway } from './ui-extension/ui-extension.js';
import { HookActionAuditSink } from './audit/action-audit-sink.js';
import { verifyExternalAgentExecutionContext } from '../runtime-store/tauri-bridge';
import type { HookActionAuditFilter, HookActionCommitRequest, HookActionCommitResult, HookActionDescriptorView, HookActionDiscoverFilter, HookActionDryRunRequest, HookActionRegistrationInput, HookActionRegistryChangeEvent, HookActionVerifyRequest, HookActionVerifyResult, HookActionResult, } from './contracts/action.js';
import { type RuntimeCanonicalCapability } from "@nimiplatform/sdk/mod";
export class DesktopHookRuntimeService implements DesktopHookRuntimeFacade {
    private readonly agentProfileReadFilters = new Map<string, {
        modId: string;
        sourceType: HookSourceType;
        handler: (input: AgentProfileReadFilterInput) => Promise<AgentProfileReadFilterResult> | AgentProfileReadFilterResult;
    }>();
    private readonly audit = new HookAuditTrail();
    private readonly registry = new HookRegistry();
    private readonly permissions = new PermissionGateway();
    private readonly eventBus = new EventBus();
    private readonly dataApi = new DataApi();
    private readonly interMod = new InterModBroker();
    private readonly uiExtension = new UiExtensionGateway();
    private readonly contracts = new HookContractRegistry();
    private readonly turnHook = new TurnHookOrchestrator(this.registry);
    private readonly permissionService: HookRuntimePermissionService;
    private readonly eventService: HookRuntimeEventService;
    private readonly dataService: HookRuntimeDataService;
    private readonly storageService: HookRuntimeStorageService;
    private readonly turnService: HookRuntimeTurnService;
    private readonly uiService: HookRuntimeUiService;
    private readonly interModService: HookRuntimeInterModService;
    private readonly lifecycleService: HookRuntimeLifecycleService;
    private readonly metaService: HookRuntimeMetaService;
    private readonly actionService: HookRuntimeActionService;
    private readonly modLocalProfileSnapshotService = new HookRuntimeModLocalProfileSnapshotService();
    private missingDataCapabilityResolver: MissingDataCapabilityResolver | null = null;
    readonly storage: DesktopHookRuntimeFacade['storage'];
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
        this.storageService = new HookRuntimeStorageService({
            audit: this.audit,
            evaluatePermission,
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
        this.metaService = new HookRuntimeMetaService({
            audit: this.audit,
            registry: this.registry,
            permissions: this.permissions,
        });
        const socialPreconditionService = new HookActionSocialPreconditionService(createCoreSocialFriendshipResolver({
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
        }));
        this.actionService = new HookRuntimeActionService({
            evaluatePermission,
            auditSink: new HookActionAuditSink(),
            socialPreconditionService,
            verifyExternalAgentContext: async (input) => verifyExternalAgentExecutionContext(input),
        });
        this.storage = {
            files: {
                readText: (input) => this.storageService.readText(input),
                writeText: (input) => this.storageService.writeText(input),
                readBytes: (input) => this.storageService.readBytes(input),
                writeBytes: (input) => this.storageService.writeBytes(input),
                delete: (input) => this.storageService.delete(input),
                list: (input) => this.storageService.list(input),
                stat: (input) => this.storageService.stat(input),
            },
            sqlite: {
                query: (input) => this.storageService.query(input),
                execute: (input) => this.storageService.execute(input),
                transaction: (input) => this.storageService.transaction(input),
            },
        };
    }
    setModSourceType(modId: string, sourceType: HookSourceType): void { this.lifecycleService.setModSourceType(modId, sourceType); }
    getModSourceType(modId: string): HookSourceType { return this.lifecycleService.getModSourceType(modId); }
    setCapabilityBaseline(modId: string, capabilities: string[]): void { this.lifecycleService.setCapabilityBaseline(modId, capabilities); }
    clearCapabilityBaseline(modId: string): void { this.lifecycleService.clearCapabilityBaseline(modId); }
    setGrantCapabilities(modId: string, capabilities: string[]): void { this.lifecycleService.setGrantCapabilities(modId, capabilities); }
    clearGrantCapabilities(modId: string): void { this.lifecycleService.clearGrantCapabilities(modId); }
    setDenialCapabilities(modId: string, capabilities: string[]): void { this.lifecycleService.setDenialCapabilities(modId, capabilities); }
    clearDenialCapabilities(modId: string): void { this.lifecycleService.clearDenialCapabilities(modId); }
    setMissingDataCapabilityResolver(resolver: MissingDataCapabilityResolver | null): void { this.missingDataCapabilityResolver = resolver; }
    setModLocalProfileSnapshotResolver(resolver: HookModLocalProfileSnapshotResolver | null): void { this.modLocalProfileSnapshotService.setResolver(resolver); }
    authorizeRuntimeCapability(input: {
        modId: string;
        sourceType?: HookSourceType;
        capabilityKey: string;
        target?: string;
    }): {
        allowed: true;
        sourceType: HookSourceType;
        reasonCodes: string[];
    } {
        return this.permissionService.evaluate({
            modId: input.modId,
            sourceType: input.sourceType,
            hookType: 'runtime',
            target: String(input.target || input.capabilityKey || '').trim(),
            capabilityKey: String(input.capabilityKey || '').trim(),
            startedAt: Date.now(),
        });
    }
    getModLocalProfileSnapshot(input: {
        modId: string;
        capability?: RuntimeCanonicalCapability;
        routeSourceHint?: 'cloud' | 'local';
    }): Promise<HookModLocalProfileSnapshot> {
        return this.modLocalProfileSnapshotService.getSnapshot(input);
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
    unsubscribeEvent(input: {
        modId: string;
        topic?: string;
    }): number {
        return this.eventService.unsubscribeEvent(input);
    }
    publishEvent(input: {
        modId: string;
        sourceType?: HookSourceType;
        topic: string;
        payload: Record<string, unknown>;
    }): Promise<{
        deliveredCount: number;
        failedCount: number;
        reasonCodes: string[];
    }> {
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
    unregisterDataProvider(input: {
        modId: string;
        capability: string;
    }): boolean {
        return this.dataService.unregisterDataProvider(input);
    }
    listDataCapabilities(): string[] {
        return this.dataService.listDataCapabilities();
    }
    registerDataCapability(capability: string, handler?: (query: Record<string, unknown>) => Promise<unknown> | unknown): void {
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
    unregisterTurnHook(input: {
        modId: string;
        point: TurnHookPoint;
    }): number {
        return this.turnService.unregisterTurnHook(input);
    }
    invokeTurnHooks(input: {
        point: TurnHookPoint;
        context: Record<string, unknown>;
        abortSignal?: AbortSignal;
    }): Promise<{
        context: Record<string, unknown>;
        errors: Array<{
            modId: string;
            point: TurnHookPoint;
            error: string;
        }>;
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
    unregisterUIExtension(input: {
        modId: string;
        slot?: string;
    }): number {
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
    unregisterInterModHandler(input: {
        modId: string;
        channel?: string;
    }): number {
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
        responses: Array<{
            modId: string;
            result: unknown;
        }>;
        errors: Array<{
            modId: string;
            error: string;
        }>;
    }> {
        return this.interModService.broadcastInterMod(input);
    }
    discoverInterModChannels(): Array<{
        channel: string;
        providers: string[];
    }> {
        return this.interModService.discoverInterModChannels();
    }
    registerActionV1(input: HookActionRegistrationInput): HookActionDescriptorView { return this.actionService.registerActionV1(input); }
    subscribeActionRegistryChanges(listener: (event: HookActionRegistryChangeEvent) => void): () => void {
        return this.actionService.subscribeActionRegistryChanges(listener);
    }
    unregisterAction(input: {
        modId: string;
        actionId: string;
    }): boolean { return this.actionService.unregisterAction(input); }
    discoverActions(filter?: HookActionDiscoverFilter): HookActionDescriptorView[] { return this.actionService.discoverActions(filter); }
    dryRunAction(input: HookActionDryRunRequest): Promise<HookActionResult> { return this.actionService.dryRunAction(input); }
    verifyAction(input: HookActionVerifyRequest): Promise<HookActionVerifyResult> { return this.actionService.verifyAction(input); }
    commitAction(input: HookActionCommitRequest): Promise<HookActionCommitResult> { return this.actionService.commitAction(input); }
    queryActionAudit(filter?: HookActionAuditFilter) { return this.actionService.queryActionAudit(filter); }
    async registerAgentProfileReadFilter(input: {
        modId: string;
        sourceType?: HookSourceType;
        handler: (input: AgentProfileReadFilterInput) => Promise<AgentProfileReadFilterResult> | AgentProfileReadFilterResult;
    }): Promise<void> {
        const startedAt = Date.now();
        const permission = this.permissionService.evaluate({
            modId: input.modId,
            sourceType: input.sourceType,
            hookType: 'runtime',
            target: 'runtime.profile.read.agent',
            capabilityKey: 'runtime.profile.read.agent',
            startedAt,
        });
        if (!permission.allowed) {
            throw new Error('HOOK_PERMISSION_DENIED');
        }
        this.agentProfileReadFilters.set(input.modId, {
            modId: input.modId,
            sourceType: permission.sourceType,
            handler: input.handler,
        });
    }
    unregisterAgentProfileReadFilter(input: {
        modId: string;
    }): boolean {
        return this.agentProfileReadFilters.delete(String(input.modId || '').trim());
    }
    async invokeAgentProfileReadFilters(input: AgentProfileReadFilterInput): Promise<Record<string, unknown>> {
        const nextProfile = {
            ...input.profile,
        };
        for (const filter of this.agentProfileReadFilters.values()) {
            const result = await filter.handler({
                viewerUserId: input.viewerUserId,
                ownerAgentId: input.ownerAgentId,
                worldId: input.worldId,
                profile: {
                    ...nextProfile,
                },
            });
            if (result && Object.prototype.hasOwnProperty.call(result, 'referenceImageUrl')) {
                nextProfile.referenceImageUrl = result.referenceImageUrl ?? null;
            }
        }
        return nextProfile;
    }
    getAudit(filter?: {
        modId?: string;
        hookType?: HookType;
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
