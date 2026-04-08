import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
    findLocalRuntimeProfileById,
    localRuntime,
} from '@runtime/local-runtime';
import type { CheckLlmHealthInput, ExecuteLocalKernelTurnInput, ExecuteLocalKernelTurnResult, ProviderHealth, } from '@runtime/llm-adapter';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import { getPlatformClient } from '@nimiplatform/sdk';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { buildRuntimeRequestMetadata, ensureRuntimeLocalModelWarm, } from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import { LifecycleSubscriptionManager } from '@renderer/mod-ui/lifecycle/lifecycle-subscription-manager';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { createResolveRuntimeBinding } from './runtime-bootstrap-route-resolvers';
import { loadRuntimeRouteOptions } from './runtime-bootstrap-route-options';
import { createModLocalProfileSnapshotResolver, readManifestProfiles, } from './runtime-bootstrap-host-capabilities-profiles';
import { createScenarioJobControllerDeps, feedControllerJobSnapshot, toControllerJobSnapshot } from './runtime-bootstrap-host-capabilities-jobs';
import { buildRuntimeMediaCapabilities } from './runtime-bootstrap-host-capabilities-media';
import { describeRuntimeRouteMetadata } from './runtime-bootstrap-host-capabilities-route-describe';
import { getRuntimeFieldsFromStore, hydrateLocalRouteBindingFromOptions, hydrateCloudRouteBindingFromOptions, requireModel, toResolvedBinding, toRouteHealthResult, } from './runtime-bootstrap-host-capabilities-routing';
import { setConversationCapabilityRouteRuntime, toRuntimeCanonicalCapability, type ConversationCapability } from '@renderer/features/chat/conversation-capability';
import {
    assertCanonicalModAIScopeRef,
    isCanonicalModAIScopeRef,
    type AIScopeRef,
    type ModSdkHost,
    type RuntimeLlmHealthInput,
    type RuntimeLlmHealthResult,
    type ModRuntimeResolvedBinding,
    type RuntimeCanonicalCapability,
    type RuntimeRouteBinding,
    type RuntimeRouteOptionsSnapshot,
} from "@nimiplatform/sdk/mod";
import { ReasonCode } from '@nimiplatform/sdk/types';

const DESKTOP_CONVERSATION_ROUTE_RUNTIME_MOD_ID = 'core:runtime';

function encodeResolvedBindingPayload(value: string): string {
    if (typeof globalThis.btoa === 'function') {
        return globalThis.btoa(value);
    }
    return Buffer.from(value, 'utf8').toString('base64');
}

function toProtoInt64String(value: number | null | undefined): string {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) {
        return '0';
    }
    return String(Math.max(0, Math.trunc(numeric)));
}

function fromProtoInt64String(value: string | number | bigint | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'bigint') {
        return Number(value);
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function createResolvedBindingRef(capability: RuntimeCanonicalCapability, resolved: Omit<ModRuntimeResolvedBinding, 'capability'>): string {
    const payload = {
        capability,
        source: String(resolved.source || '').trim(),
        provider: String(resolved.provider || '').trim(),
        model: String(resolved.model || '').trim(),
        modelId: String(resolved.modelId || '').trim(),
        connectorId: String(resolved.connectorId || '').trim(),
        localModelId: String(resolved.localModelId || '').trim(),
        engine: String(resolved.engine || '').trim(),
        endpoint: String(resolved.endpoint || '').trim(),
        localProviderEndpoint: String(resolved.localProviderEndpoint || '').trim(),
        localOpenAiEndpoint: String(resolved.localOpenAiEndpoint || '').trim(),
        goRuntimeLocalModelId: String(resolved.goRuntimeLocalModelId || '').trim(),
    };
    return encodeResolvedBindingPayload(JSON.stringify(payload));
}
type HostCapabilityInput = {
    checkLocalLlmHealth: (input: CheckLlmHealthInput) => Promise<ProviderHealth>;
    executeLocalKernelTurn: (input: ExecuteLocalKernelTurnInput) => Promise<ExecuteLocalKernelTurnResult>;
    withOpenApiContextLock: <T>(context: { realmBaseUrl: string; accessToken?: string; fetchImpl?: typeof fetch }, task: () => Promise<T>) => Promise<T>;
    getRuntimeHookRuntime: () => DesktopHookRuntimeService;
};
export function buildRuntimeHostCapabilities(input: HostCapabilityInput): ModSdkHost {
    const lifecycleManager = new LifecycleSubscriptionManager();
    const hookRuntime = input.getRuntimeHookRuntime();
    const desktopAIConfigService = getDesktopAIConfigService();
    hookRuntime.setModLocalProfileSnapshotResolver(createModLocalProfileSnapshotResolver());
    const resolveRuntimeBinding = createResolveRuntimeBinding(() => getRuntimeFieldsFromStore());
    const resolvedBindingRegistry = new Map<string, {
        capability: RuntimeCanonicalCapability;
        resolvedBinding: ModRuntimeResolvedBinding;
    }>();
    const authorizeRuntimeCapability = (payload: {
        modId: string;
        capabilityKey: string;
        target?: string;
    }) => {
        hookRuntime.authorizeRuntimeCapability({
            modId: payload.modId,
            capabilityKey: payload.capabilityKey,
            target: payload.target,
        });
    };
    const toHealthInput = (payload: RuntimeLlmHealthInput): CheckLlmHealthInput | null => {
        const runtime = getRuntimeFieldsFromStore();
        const provider = String(payload.provider || runtime.provider || '').trim();
        if (!provider) {
            return null;
        }
        return {
            provider,
            localProviderEndpoint: payload.localProviderEndpoint || runtime.localProviderEndpoint,
            localProviderModel: payload.localProviderModel || runtime.localProviderModel,
            localOpenAiEndpoint: payload.localOpenAiEndpoint || runtime.localOpenAiEndpoint,
            connectorId: payload.connectorId || runtime.connectorId,
        };
    };
    const registerResolvedBinding = (capability: RuntimeCanonicalCapability, resolvedBinding: ModRuntimeResolvedBinding): ModRuntimeResolvedBinding => {
        const resolvedBindingRef = createResolvedBindingRef(capability, resolvedBinding);
        const registeredBinding = {
            ...resolvedBinding,
            resolvedBindingRef,
        };
        resolvedBindingRegistry.set(resolvedBindingRef, {
            capability,
            resolvedBinding: registeredBinding,
        });
        return registeredBinding;
    };
    const resolveRuntimeRoute = async (payload: {
        modId: string;
        capability: RuntimeCanonicalCapability;
        binding?: RuntimeRouteBinding;
    }): Promise<ModRuntimeResolvedBinding> => {
        const aiConfigBindings = useAppStore.getState().aiConfig.capabilities.selectedBindings;
        const selectedBinding = payload.capability === 'text.embed'
            ? undefined
            : (aiConfigBindings[payload.capability] as RuntimeRouteBinding | null | undefined) ?? undefined;
        let effectiveBinding = payload.binding ?? (selectedBinding === null ? undefined : selectedBinding);
        if (!effectiveBinding) {
            throw new Error('RUNTIME_ROUTE_SELECTION_REQUIRED');
        }
        const hasModel = Boolean(String(effectiveBinding?.model || effectiveBinding?.localModelId || '').trim());
        const needsLocalHydration = effectiveBinding?.source === 'local';
        const needsCloudHydration = effectiveBinding?.source === 'cloud'
            && (!String(effectiveBinding.connectorId || '').trim()
                || !String(effectiveBinding.provider || '').trim());
        let options: RuntimeRouteOptionsSnapshot | null = null;
        if (!effectiveBinding || !hasModel || needsCloudHydration || needsLocalHydration) {
            options = await loadRuntimeRouteOptions({
                capability: payload.capability,
                modId: payload.modId,
            });
        }
        if (!hasModel) {
            throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
        }
        if (options && effectiveBinding.source === 'local') {
            effectiveBinding = hydrateLocalRouteBindingFromOptions(effectiveBinding, options);
        }
        else if (options && effectiveBinding.source === 'cloud') {
            effectiveBinding = hydrateCloudRouteBindingFromOptions(effectiveBinding, options);
        }
        const resolved = await resolveRuntimeBinding({
            modId: payload.modId,
            binding: effectiveBinding,
        });
        return registerResolvedBinding(
            payload.capability,
            toResolvedBinding(payload.capability, resolved),
        );
    };
    const checkRuntimeRouteHealth = async (payload: {
        modId: string;
        capability: RuntimeCanonicalCapability;
        binding?: RuntimeRouteBinding;
    }): Promise<RuntimeLlmHealthResult> => {
        const resolved = await resolveRuntimeRoute(payload);
        const result = await input.checkLocalLlmHealth({
            provider: resolved.provider,
            localProviderEndpoint: resolved.localProviderEndpoint || resolved.endpoint,
            localProviderModel: resolved.model,
            localOpenAiEndpoint: resolved.localOpenAiEndpoint || resolved.endpoint,
            localModelId: resolved.localModelId,
            goRuntimeLocalModelId: resolved.goRuntimeLocalModelId,
            goRuntimeStatus: resolved.goRuntimeStatus,
            connectorId: resolved.connectorId,
        });
        return toRouteHealthResult(result, resolved.provider, resolved.source);
    };
    const describeRuntimeRoute = async (payload: {
        modId: string;
        capability: RuntimeCanonicalCapability;
        resolvedBindingRef: string;
    }) => {
        const resolvedBindingRef = String(payload.resolvedBindingRef || '').trim();
        const registered = resolvedBindingRegistry.get(resolvedBindingRef) || null;
        if (!registered || registered.capability !== payload.capability) {
            throw new Error('RUNTIME_ROUTE_DESCRIBE_BINDING_REF_INVALID');
        }
        if (
            payload.capability !== 'text.generate'
            && payload.capability !== 'voice_workflow.tts_v2v'
            && payload.capability !== 'voice_workflow.tts_t2v'
        ) {
            throw new Error('RUNTIME_ROUTE_DESCRIBE_CAPABILITY_UNSUPPORTED');
        }
        return describeRuntimeRouteMetadata({
            modId: payload.modId,
            capability: payload.capability,
            resolvedBinding: registered.resolvedBinding,
            resolvedBindingRef,
        });
    };
    const buildMetadata = async (inputValue: {
        source: 'local' | 'cloud';
        connectorId?: string;
        endpoint?: string;
    }): Promise<Record<string, string>> => buildRuntimeRequestMetadata({
        source: inputValue.source,
        connectorId: inputValue.connectorId,
        providerEndpoint: inputValue.endpoint,
    });
    const getRuntimeClient = () => getPlatformClient().runtime;
    const toCanonicalModScopeRef = (scopeRef: AIScopeRef | null | undefined, modId: string) =>
        assertCanonicalModAIScopeRef(scopeRef, modId);
    const invalidSnapshotAccessError = (modId: string, executionId: string) => createNimiError({
        message: `AISnapshot ${executionId} does not belong to mod ${modId}`,
        reasonCode: ReasonCode.ACTION_INPUT_INVALID,
        actionHint: 'use_snapshot_from_caller_mod_scope',
        source: 'runtime',
    });
    const toKernelTurnInput = (payload: ModSdkHost['runtime']['executeLocalKernelTurn'] extends (input: infer T) => Promise<unknown> ? T : never): ExecuteLocalKernelTurnInput | null => {
        const runtime = getRuntimeFieldsFromStore();
        const provider = String(payload.provider || runtime.provider || '').trim();
        if (!provider) {
            return null;
        }
        return {
            requestId: String(payload.requestId || ''),
            sessionId: String(payload.sessionId || ''),
            turnIndex: Number(payload.turnIndex || 0),
            mode: payload.mode || 'SCENE_TURN',
            userInputText: String(payload.userInputText || ''),
            provider,
            worldId: payload.worldId,
            agentId: payload.agentId,
            localProviderEndpoint: payload.localProviderEndpoint || runtime.localProviderEndpoint,
            localProviderModel: payload.localProviderModel || runtime.localProviderModel,
            localOpenAiEndpoint: payload.localOpenAiEndpoint || runtime.localOpenAiEndpoint,
            connectorId: payload.connectorId || runtime.connectorId,
        };
    };
    setConversationCapabilityRouteRuntime({
        resolve: async ({ capability, binding }) => resolveRuntimeRoute({
            modId: DESKTOP_CONVERSATION_ROUTE_RUNTIME_MOD_ID,
            capability: toRuntimeCanonicalCapability(capability),
            binding,
        }),
        checkHealth: async ({ capability, binding }) => checkRuntimeRouteHealth({
            modId: DESKTOP_CONVERSATION_ROUTE_RUNTIME_MOD_ID,
            capability: toRuntimeCanonicalCapability(capability),
            binding,
        }),
        describe: async ({ capability, resolvedBindingRef }) => describeRuntimeRoute({
            modId: DESKTOP_CONVERSATION_ROUTE_RUNTIME_MOD_ID,
            capability: toRuntimeCanonicalCapability(capability),
            resolvedBindingRef,
        }),
    });
    return {
        runtime: {
            checkLocalLlmHealth: async (payload: RuntimeLlmHealthInput): Promise<RuntimeLlmHealthResult> => {
                const resolvedInput = toHealthInput(payload);
                if (!resolvedInput) {
                    return {
                        healthy: false,
                        status: 'unavailable',
                        detail: 'Runtime provider is missing',
                    };
                }
                return input.checkLocalLlmHealth(resolvedInput);
            },
            executeLocalKernelTurn: async (payload) => {
                const resolvedInput = toKernelTurnInput(payload);
                if (!resolvedInput) {
                    return {
                        error: 'RUNTIME_PROVIDER_MISSING',
                        detail: 'Runtime provider is missing',
                    };
                }
                return input.executeLocalKernelTurn(resolvedInput);
            },
            withOpenApiContextLock: <T>(context: {
                realmBaseUrl: string;
                accessToken?: string;
                fetchImpl?: typeof fetch;
            }, task: () => Promise<T>) => input.withOpenApiContextLock<T>(context, task),
            getRuntimeHookRuntime: () => hookRuntime,
            getModLocalProfileSnapshot: (payload) => hookRuntime.getModLocalProfileSnapshot(payload),
            route: {
                listOptions: async ({ capability, modId }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.route.list.options',
                    });
                    return loadRuntimeRouteOptions({ capability, modId });
                },
                resolve: async ({ capability, modId, binding }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.route.resolve',
                    });
                    return resolveRuntimeRoute({ capability, modId, binding });
                },
                checkHealth: async ({ capability, modId, binding }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.route.check.health',
                    });
                    return checkRuntimeRouteHealth({ capability, modId, binding });
                },
                describe: async ({ capability, modId, resolvedBindingRef }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.route.describe',
                    });
                    return describeRuntimeRoute({
                        modId,
                        capability,
                        resolvedBindingRef,
                    });
                },
            },
            scheduler: {
                peek: async (peekInput) => {
                    const client = getRuntimeClient();
                    try {
                        const response = await client.ai.peekScheduling({
                            appId: String(peekInput.appId || '').trim() || '_default',
                            targets: (peekInput.targets || []).map((target) => ({
                                capability: String(target.capability || '').trim(),
                                modId: String(target.modId || '').trim(),
                                profileId: String(target.profileId || '').trim(),
                                resourceHint: target.resourceHint ? {
                                    estimatedVramBytes: toProtoInt64String(target.resourceHint.estimatedVramBytes),
                                    estimatedRamBytes: toProtoInt64String(target.resourceHint.estimatedRamBytes),
                                    estimatedDiskBytes: toProtoInt64String(target.resourceHint.estimatedDiskBytes),
                                    engine: String(target.resourceHint.engine || '').trim(),
                                } : undefined,
                            })),
                        });
                        const stateMap: Record<number, string> = {
                            0: 'unknown', 1: 'runnable', 2: 'queue_required',
                            3: 'preemption_risk', 4: 'slowdown_risk', 5: 'denied', 6: 'unknown',
                        };
                        const toOccupancy = (occ: {
                            globalUsed: number;
                            globalCap: number;
                            appUsed: number;
                            appCap: number;
                        } | null | undefined) => occ ? {
                            globalUsed: occ.globalUsed,
                            globalCap: occ.globalCap,
                            appUsed: occ.appUsed,
                            appCap: occ.appCap,
                        } : null;
                        const toJudgement = (judgement: {
                            state: number;
                            detail: string;
                            occupancy?: {
                                globalUsed: number;
                                globalCap: number;
                                appUsed: number;
                                appCap: number;
                            } | null;
                            resourceWarnings?: string[];
                        } | null | undefined) => judgement ? ({
                            state: stateMap[judgement.state] || 'unknown',
                            detail: judgement.detail || '',
                            occupancy: toOccupancy(judgement.occupancy),
                            resourceWarnings: judgement.resourceWarnings || [],
                        }) : null;
                        const aggregateJudgement = toJudgement(response?.aggregateJudgement);
                        if (!aggregateJudgement) {
                            return { occupancy: null, aggregateJudgement: null, targetJudgements: [] };
                        }
                        return {
                            occupancy: toOccupancy(response?.occupancy),
                            aggregateJudgement,
                            targetJudgements: (response?.targetJudgements || []).map((entry) => ({
                                target: {
                                    capability: entry.target?.capability || '',
                                    modId: entry.target?.modId || null,
                                    profileId: entry.target?.profileId || null,
                                    resourceHint: entry.target?.resourceHint ? {
                                        estimatedVramBytes: fromProtoInt64String(entry.target.resourceHint.estimatedVramBytes),
                                        estimatedRamBytes: fromProtoInt64String(entry.target.resourceHint.estimatedRamBytes),
                                        estimatedDiskBytes: fromProtoInt64String(entry.target.resourceHint.estimatedDiskBytes),
                                        engine: entry.target.resourceHint.engine || null,
                                    } : null,
                                },
                                judgement: toJudgement(entry.judgement) || {
                                    state: 'unknown',
                                    detail: 'empty target judgement',
                                    occupancy: null,
                                    resourceWarnings: [],
                                },
                            })),
                        };
                    } catch {
                        return {
                            occupancy: null,
                            aggregateJudgement: null,
                            targetJudgements: [],
                        };
                    }
                },
            },
            local: {
                listAssets: async ({ modId, ...payload }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.local.assets.list',
                    });
                    return localRuntime.listAssets(payload);
                },
                listProfiles: async ({ modId }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.local.profiles.list',
                    });
                    return readManifestProfiles(modId);
                },
                requestProfileInstall: async ({ modId, profileId, capability, confirmMessage, entryOverrides }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.local.profiles.install.request',
                    });
                    const profiles = readManifestProfiles(modId);
                    const profile = findLocalRuntimeProfileById(profiles, profileId);
                    if (!profile) {
                        return {
                            modId,
                            profileId: String(profileId || '').trim(),
                            accepted: false,
                            declined: false,
                            warnings: ['profile not found'],
                            reasonCode: ReasonCode.LOCAL_AI_PROFILE_NOT_FOUND,
                        };
                    }
                    const message = String(confirmMessage || '').trim()
                        || `Install recommended local profile "${profile.title}" for ${modId}?`;
                    const accepted = typeof window !== 'undefined' && typeof window.confirm === 'function'
                        ? window.confirm(message)
                        : true;
                    if (!accepted) {
                        return {
                            modId,
                            profileId: profile.id,
                            accepted: false,
                            declined: true,
                            warnings: ['user declined local profile install'],
                            reasonCode: ReasonCode.LOCAL_AI_PROFILE_INSTALL_DECLINED,
                        };
                    }
                    const plan = await localRuntime.resolveProfile({
                        modId,
                        profile,
                        capability: String(capability || '').trim() || undefined,
                        entryOverrides,
                    });
                    const result = await localRuntime.applyProfile(plan, { caller: 'core' });
                    return {
                        modId,
                        profileId: profile.id,
                        accepted: true,
                        declined: false,
                        warnings: result.warnings,
                        reasonCode: result.reasonCode,
                    };
                },
                getProfileInstallStatus: async ({ modId, profileId, capability, entryOverrides }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.local.profiles.list',
                    });
                    const profiles = readManifestProfiles(modId);
                    const profile = findLocalRuntimeProfileById(profiles, profileId);
                    if (!profile) {
                        return {
                            modId,
                            profileId: String(profileId || '').trim(),
                            status: 'missing',
                            warnings: ['profile not found'],
                            missingEntries: [String(profileId || '').trim()].filter(Boolean),
                            updatedAt: new Date().toISOString(),
                        };
                    }
                    return localRuntime.getProfileInstallStatus({
                        modId,
                        profile,
                        capability: String(capability || '').trim() || undefined,
                        entryOverrides,
                    });
                },
            },
            aiConfig: {
                get: ({ modId, scopeRef }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-config.get',
                    });
                    return desktopAIConfigService.aiConfig.get(toCanonicalModScopeRef(scopeRef, modId));
                },
                update: ({ modId, scopeRef, config }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-config.update',
                    });
                    const canonicalScopeRef = toCanonicalModScopeRef(scopeRef, modId);
                    desktopAIConfigService.aiConfig.update(canonicalScopeRef, {
                        ...config,
                        scopeRef: canonicalScopeRef,
                    });
                },
                listScopes: ({ modId }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-config.list.scopes',
                    });
                    return desktopAIConfigService.aiConfig.listScopes().filter((scopeRef) =>
                        isCanonicalModAIScopeRef(scopeRef, modId));
                },
                probe: async ({ modId, scopeRef }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-config.probe',
                    });
                    return desktopAIConfigService.aiConfig.probe(toCanonicalModScopeRef(scopeRef, modId));
                },
                probeFeasibility: async ({ modId, scopeRef }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-config.probe.feasibility',
                    });
                    return desktopAIConfigService.aiConfig.probeFeasibility(
                        toCanonicalModScopeRef(scopeRef, modId),
                    );
                },
                probeSchedulingTarget: async ({ modId, scopeRef, target }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-config.probe.scheduling.target',
                    });
                    return desktopAIConfigService.aiConfig.probeSchedulingTarget(
                        toCanonicalModScopeRef(scopeRef, modId),
                        target,
                    );
                },
                subscribe: ({ modId, scopeRef, callback }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-config.subscribe',
                    });
                    return desktopAIConfigService.aiConfig.subscribe(
                        toCanonicalModScopeRef(scopeRef, modId),
                        callback,
                    );
                },
            },
            aiSnapshot: {
                record: ({ modId, scopeRef, snapshot }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-snapshot.record',
                    });
                    const canonicalScopeRef = toCanonicalModScopeRef(scopeRef, modId);
                    desktopAIConfigService.aiSnapshot.record(canonicalScopeRef, {
                        ...snapshot,
                        scopeRef: canonicalScopeRef,
                    });
                },
                get: ({ modId, executionId }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-snapshot.get',
                    });
                    const snapshot = desktopAIConfigService.aiSnapshot.get(executionId);
                    if (!snapshot) {
                        return null;
                    }
                    if (!isCanonicalModAIScopeRef(snapshot.scopeRef, modId)) {
                        throw invalidSnapshotAccessError(modId, executionId);
                    }
                    return snapshot;
                },
                getLatest: ({ modId, scopeRef }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.ai-snapshot.get.latest',
                    });
                    return desktopAIConfigService.aiSnapshot.getLatest(toCanonicalModScopeRef(scopeRef, modId));
                },
            },
            ai: {
                text: {
                    generate: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.ai.text.generate',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'text.generate',
                            binding,
                        });
                        const model = requireModel(request.model || resolved.model, 'MOD_RUNTIME_TEXT_MODEL_REQUIRED');
                        await ensureRuntimeLocalModelWarm({
                            modId,
                            source: resolved.source,
                            modelId: model,
                            localModelId: resolved.localModelId || undefined,
                            goRuntimeLocalModelId: resolved.goRuntimeLocalModelId || undefined,
                            engine: resolved.engine || resolved.provider || undefined,
                            endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint || undefined,
                            timeoutMs: Number(request.timeoutMs || 0) || undefined,
                        });
                        return getRuntimeClient().ai.text.generate({
                            ...request,
                            model,
                            route: resolved.source,
                            connectorId: resolved.connectorId || undefined,
                            metadata: {
                                ...(request.metadata || {}),
                                ...(await buildMetadata({
                                    source: resolved.source,
                                    connectorId: resolved.connectorId || undefined,
                                    endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                                })),
                            },
                        });
                    },
                    stream: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.ai.text.stream',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'text.generate',
                            binding,
                        });
                        const model = requireModel(request.model || resolved.model, 'MOD_RUNTIME_TEXT_MODEL_REQUIRED');
                        await ensureRuntimeLocalModelWarm({
                            modId,
                            source: resolved.source,
                            modelId: model,
                            localModelId: resolved.localModelId || undefined,
                            goRuntimeLocalModelId: resolved.goRuntimeLocalModelId || undefined,
                            engine: resolved.engine || resolved.provider || undefined,
                            endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint || undefined,
                            timeoutMs: Number(request.timeoutMs || 0) || undefined,
                        });
                        return getRuntimeClient().ai.text.stream({
                            ...request,
                            model,
                            route: resolved.source,
                            connectorId: resolved.connectorId || undefined,
                            metadata: {
                                ...(request.metadata || {}),
                                ...(await buildMetadata({
                                    source: resolved.source,
                                    connectorId: resolved.connectorId || undefined,
                                    endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                                })),
                            },
                        });
                    },
                },
                embedding: {
                    generate: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.ai.embedding.generate',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'text.embed',
                            binding,
                        });
                        return getRuntimeClient().ai.embedding.generate({
                            ...request,
                            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_EMBEDDING_MODEL_REQUIRED'),
                            route: resolved.source,
                            connectorId: resolved.connectorId || undefined,
                            metadata: {
                                ...(request.metadata || {}),
                                ...(await buildMetadata({
                                    source: resolved.source,
                                    connectorId: resolved.connectorId || undefined,
                                    endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
                                })),
                            },
                        });
                    },
                },
            },
            media: buildRuntimeMediaCapabilities({
                authorizeRuntimeCapability,
                resolveRuntimeRoute: async (payload) => {
                    if (payload.conversationExecution && !payload.binding) {
                        const projections = useAppStore.getState().conversationCapabilityProjectionByCapability;
                        const projection = projections[payload.capability as ConversationCapability] || null;
                        if (projection && projection.supported && projection.resolvedBinding) {
                            return registerResolvedBinding(payload.capability, projection.resolvedBinding);
                        }
                        if (projection && !projection.supported && projection.reasonCode) {
                            throw new Error(
                                `CONVERSATION_CAPABILITY_PROJECTION_UNAVAILABLE: ${payload.capability} — ${projection.reasonCode}`,
                            );
                        }
                    }
                    return resolveRuntimeRoute(payload);
                },
                buildMetadata,
                getRuntimeClient,
                feedControllerJobSnapshot,
                toControllerJobSnapshot,
                createScenarioJobControllerDeps: (inputValue) => createScenarioJobControllerDeps({ getRuntimeClient }, inputValue),
            }),
            voice: {
                getAsset: async ({ modId, request }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.voice.get.asset',
                    });
                    return getRuntimeClient().ai.getVoiceAsset(request);
                },
                listAssets: async ({ modId, request }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.voice.list.assets',
                    });
                    return getRuntimeClient().ai.listVoiceAssets(request);
                },
                deleteAsset: async ({ modId, request }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.voice.delete.asset',
                    });
                    return getRuntimeClient().ai.deleteVoiceAsset(request);
                },
                listPresetVoices: async ({ modId, binding, modelId, connectorId, ...request }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.voice.list.preset.voices',
                    });
                    const resolved = await resolveRuntimeRoute({
                        modId,
                        capability: 'audio.synthesize',
                        binding,
                    });
                    return getRuntimeClient().ai.listPresetVoices({
                        ...request,
                        modelId: requireModel(modelId || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
                        connectorId: connectorId || resolved.connectorId || '',
                    });
                },
            },
        },
        ui: {
            useAppStore: <T>(selector: (state: unknown) => T): T => useAppStore((state) => selector(state)),
            SlotHost: SlotHost as any,
            useUiExtensionContext,
        },
        shell: {
            useAuth: () => {
                const status = useAppStore((state) => state.auth.status);
                const user = useAppStore((state) => state.auth.user);
                return {
                    isAuthenticated: status === 'authenticated',
                    user,
                };
            },
            useBootstrap: () => {
                const ready = useAppStore((state) => state.bootstrapReady);
                const error = useAppStore((state) => state.bootstrapError);
                return { ready, error };
            },
            useNavigation: () => {
                const activeTab = useAppStore((state) => state.activeTab);
                const setActiveTab = useAppStore((state) => state.setActiveTab);
                const navigateToProfile = useAppStore((state) => state.navigateToProfile);
                return {
                    activeTab,
                    setActiveTab: (tab) => setActiveTab(tab as typeof activeTab),
                    navigateToProfile,
                };
            },
            useRuntimeFields: () => {
                const runtimeFields = useAppStore((state) => state.runtimeFields);
                const setRuntimeField = useAppStore((state) => state.setRuntimeField);
                const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
                return {
                    runtimeFields,
                    setRuntimeField,
                    setRuntimeFields,
                };
            },
            useStatusBanner: () => {
                const setStatusBanner = useAppStore((state) => state.setStatusBanner);
                return {
                    showStatusBanner: setStatusBanner,
                };
            },
        },
        settings: {
            useRuntimeModSettings: (modId) => {
                const runtimeModSettingsById = useAppStore((state) => state.runtimeModSettingsById);
                return runtimeModSettingsById[String(modId || '').trim()] || {};
            },
            setRuntimeModSettings: (modId, settings) => {
                useAppStore.getState().setRuntimeModSettings(modId, settings);
            },
        },
        logging: {
            emitRuntimeLog,
            createRendererFlowId,
            logRendererEvent,
        },
        lifecycle: {
            subscribe: (tabId, handler) => lifecycleManager.subscribe(tabId, handler),
            getState: (tabId) => lifecycleManager.getState(tabId),
        },
    };
}
