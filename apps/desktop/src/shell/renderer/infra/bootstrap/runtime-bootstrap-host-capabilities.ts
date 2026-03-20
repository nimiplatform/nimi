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
import { buildRuntimeRequestMetadata, ensureRuntimeLocalModelWarm, } from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import { LifecycleSubscriptionManager } from '@renderer/mod-ui/lifecycle/lifecycle-subscription-manager';
import { createResolveRuntimeBinding } from './runtime-bootstrap-route-resolvers';
import { loadRuntimeRouteOptions } from './runtime-bootstrap-route-options';
import { createModLocalProfileSnapshotResolver, readManifestProfiles, } from './runtime-bootstrap-host-capabilities-profiles';
import { createScenarioJobControllerDeps, feedControllerJobSnapshot, toControllerJobSnapshot } from './runtime-bootstrap-host-capabilities-jobs';
import { buildRuntimeMediaCapabilities } from './runtime-bootstrap-host-capabilities-media';
import { getRuntimeFieldsFromStore, hydrateLocalRouteBindingFromOptions, hydrateCloudRouteBindingFromOptions, requireModel, toResolvedBinding, toRouteHealthResult, } from './runtime-bootstrap-host-capabilities-routing';
import { type ModSdkHost, type RuntimeLlmHealthInput, type RuntimeLlmHealthResult, type ModRuntimeResolvedBinding, type RuntimeCanonicalCapability, type RuntimeRouteBinding, type RuntimeRouteOptionsSnapshot } from "@nimiplatform/sdk/mod";
import { ReasonCode } from '@nimiplatform/sdk/types';
type HostCapabilityInput = {
    checkLocalLlmHealth: (input: CheckLlmHealthInput) => Promise<ProviderHealth>;
    executeLocalKernelTurn: (input: ExecuteLocalKernelTurnInput) => Promise<ExecuteLocalKernelTurnResult>;
    withOpenApiContextLock: <T>(context: { realmBaseUrl: string; accessToken?: string; fetchImpl?: typeof fetch }, task: () => Promise<T>) => Promise<T>;
    getRuntimeHookRuntime: () => DesktopHookRuntimeService;
};
export function buildRuntimeHostCapabilities(input: HostCapabilityInput): ModSdkHost {
    const lifecycleManager = new LifecycleSubscriptionManager();
    const hookRuntime = input.getRuntimeHookRuntime();
    hookRuntime.setModLocalProfileSnapshotResolver(createModLocalProfileSnapshotResolver());
    const resolveRuntimeBinding = createResolveRuntimeBinding(() => getRuntimeFieldsFromStore());
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
    const resolveRuntimeRoute = async (payload: {
        modId: string;
        capability: RuntimeCanonicalCapability;
        binding?: RuntimeRouteBinding;
    }): Promise<ModRuntimeResolvedBinding> => {
        let effectiveBinding = payload.binding;
        const hasModel = Boolean(String(effectiveBinding?.model || effectiveBinding?.localModelId || '').trim());
        const localGoRuntimeStatus = String(effectiveBinding?.goRuntimeStatus || '').trim().toLowerCase();
        const needsLocalHydration = effectiveBinding?.source === 'local'
            && (!String(effectiveBinding.localModelId || '').trim()
                || !String(effectiveBinding.engine || '').trim()
                || !String(effectiveBinding.adapter || '').trim()
                || localGoRuntimeStatus === 'removed');
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
        if (!effectiveBinding || !hasModel) {
            effectiveBinding = options?.selected;
        }
        else if (options && effectiveBinding.source === 'local') {
            effectiveBinding = hydrateLocalRouteBindingFromOptions(effectiveBinding, options);
        }
        else if (options && effectiveBinding.source === 'cloud') {
            effectiveBinding = hydrateCloudRouteBindingFromOptions(effectiveBinding, options);
        }
        const resolved = await resolveRuntimeBinding({
            modId: payload.modId,
            binding: effectiveBinding,
        });
        return toResolvedBinding(payload.capability, resolved);
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
                    const resolved = await resolveRuntimeRoute({ capability, modId, binding });
                    const result = await input.checkLocalLlmHealth({
                        provider: resolved.provider,
                        localProviderEndpoint: resolved.localProviderEndpoint || resolved.endpoint,
                        localProviderModel: resolved.model,
                        localOpenAiEndpoint: resolved.localOpenAiEndpoint || resolved.endpoint,
                        connectorId: resolved.connectorId,
                    });
                    return toRouteHealthResult(result, resolved.provider, resolved.source);
                },
            },
            local: {
                listArtifacts: async ({ modId, ...payload }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.local.artifacts.list',
                    });
                    return localRuntime.listArtifacts(payload);
                },
                listProfiles: async ({ modId }) => {
                    authorizeRuntimeCapability({
                        modId,
                        capabilityKey: 'runtime.local.profiles.list',
                    });
                    return readManifestProfiles(modId);
                },
                requestProfileInstall: async ({ modId, profileId, capability, confirmMessage }) => {
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
                getProfileInstallStatus: async ({ modId, profileId, capability }) => {
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
                    });
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
                resolveRuntimeRoute,
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
