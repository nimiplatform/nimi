import type { CheckLlmHealthInput, ExecuteLocalKernelTurnInput, ExecuteLocalKernelTurnResult, ProviderHealth, } from '@runtime/llm-adapter';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import { getPlatformClient } from '@nimiplatform/sdk';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { buildRuntimeRequestMetadata, ensureRuntimeLocalModelWarm, } from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import { LifecycleSubscriptionManager } from '@renderer/mod-ui/lifecycle/lifecycle-subscription-manager';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { createResolveRuntimeBinding } from './runtime-bootstrap-route-resolvers';
import { loadRuntimeRouteOptions } from './runtime-bootstrap-route-options';
import { createModLocalProfileSnapshotResolver } from './runtime-bootstrap-host-capabilities-profiles';
import { createScenarioJobControllerDeps, feedControllerJobSnapshot, toControllerJobSnapshot } from './runtime-bootstrap-host-capabilities-jobs';
import { buildRuntimeMediaCapabilities } from './runtime-bootstrap-host-capabilities-media';
import { describeRuntimeRouteMetadata } from './runtime-bootstrap-host-capabilities-route-describe';
import { getRuntimeFieldsFromStore, hydrateLocalRouteBindingFromOptions, hydrateCloudRouteBindingFromOptions, requireModel, toResolvedBinding, toRouteHealthResult, } from './runtime-bootstrap-host-capabilities-routing';
import {
    buildRuntimeAIConfigCapabilities,
    buildRuntimeAISnapshotCapabilities,
    buildRuntimeCompatibilityAdapters,
    buildRuntimeLocalCapabilities,
    buildRuntimeSchedulerCapabilities,
    buildRuntimeVoiceCapabilities,
} from './runtime-bootstrap-host-capabilities-support';
import { buildRuntimeHostShellCapabilities } from './runtime-bootstrap-host-capabilities-shell';
import { setConversationCapabilityRouteRuntime, toRuntimeCanonicalCapability, type ConversationCapability } from '@renderer/features/chat/conversation-capability';
import { createDesktopWorldEvolutionSelectorReadAdapter } from '@runtime/world-evolution/selector-read-adapter';
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
    const worldEvolution = createDesktopWorldEvolutionSelectorReadAdapter();
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
            capability: String(payload.capability || ''),
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
            capability: payload.capability,
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
        worldEvolution,
        runtime: {
            ...buildRuntimeCompatibilityAdapters({
                checkLocalLlmHealth: input.checkLocalLlmHealth,
                executeLocalKernelTurn: input.executeLocalKernelTurn,
                getRuntimeHookRuntime: input.getRuntimeHookRuntime,
                toHealthInput,
                toKernelTurnInput,
                withOpenApiContextLock: input.withOpenApiContextLock,
            }),
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
            scheduler: buildRuntimeSchedulerCapabilities({ getRuntimeClient }),
            local: buildRuntimeLocalCapabilities({ authorizeRuntimeCapability }),
            aiConfig: buildRuntimeAIConfigCapabilities({
                authorizeRuntimeCapability,
                desktopAIConfigService,
                isCanonicalModAIScopeRef,
                toCanonicalModScopeRef,
            }),
            aiSnapshot: buildRuntimeAISnapshotCapabilities({
                authorizeRuntimeCapability,
                desktopAIConfigService,
                invalidSnapshotAccessError,
                toCanonicalModScopeRef,
                isCanonicalModAIScopeRef,
            }),
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
            voice: buildRuntimeVoiceCapabilities({
                authorizeRuntimeCapability,
                getRuntimeClient,
                requireModel,
                resolveRuntimeRoute,
            }),
        },
        ...buildRuntimeHostShellCapabilities({ lifecycleManager }),
    };
}
