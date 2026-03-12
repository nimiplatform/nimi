import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { localAiRuntime, } from '@runtime/local-ai-runtime';
import type { CheckLlmHealthInput, ExecuteLocalKernelTurnInput, ExecuteLocalKernelTurnResult, ProviderHealth, } from '@runtime/llm-adapter';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import { getPlatformClient } from '@runtime/platform-client';
import { buildRuntimeRequestMetadata, ensureRuntimeLocalModelWarm, } from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import { LifecycleSubscriptionManager } from '@renderer/mod-ui/lifecycle/lifecycle-subscription-manager';
import {
    getJobState,
    feedJobEvent,
    requestCancel,
    startJobTracking,
    startPollingRecovery,
    type JobControllerDeps,
    type JobPollResult,
    type JobStatus,
} from '../../features/turns/scenario-job-controller';
import { createResolveRuntimeBinding } from './runtime-bootstrap-route-resolvers';
import { loadRuntimeRouteOptions } from './runtime-bootstrap-route-options';
import { cacheSpeechArtifactsForDesktopPlayback, createModAiDependencySnapshotResolver, } from './runtime-bootstrap-host-capabilities-dependencies';
import { ensureResolvedLocalModelAvailable, getRuntimeFieldsFromStore, hydrateLocalRouteBindingFromOptions, hydrateCloudRouteBindingFromOptions, requireModel, toResolvedBinding, toRouteHealthResult, } from './runtime-bootstrap-host-capabilities-routing';
import { type ModSdkHost, type RuntimeLlmHealthInput, type RuntimeLlmHealthResult, type ModRuntimeResolvedBinding, type RuntimeCanonicalCapability, type RuntimeRouteBinding, type RuntimeRouteOptionsSnapshot } from "@nimiplatform/sdk/mod";
type HostCapabilityInput = {
    checkLocalLlmHealth: (input: CheckLlmHealthInput) => Promise<ProviderHealth>;
    executeLocalKernelTurn: (input: ExecuteLocalKernelTurnInput) => Promise<ExecuteLocalKernelTurnResult>;
    withOpenApiContextLock: <T>(context: {
        realmBaseUrl: string;
        accessToken?: string;
        fetchImpl?: typeof fetch;
    }, task: () => Promise<T>) => Promise<T>;
    getRuntimeHookRuntime: () => DesktopHookRuntimeService;
};
export function buildRuntimeHostCapabilities(input: HostCapabilityInput): ModSdkHost {
    const lifecycleManager = new LifecycleSubscriptionManager();
    const hookRuntime = input.getRuntimeHookRuntime();
    hookRuntime.setModAiDependencySnapshotResolver(createModAiDependencySnapshotResolver());
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
    const normalizeScenarioJobStatus = (value: unknown): JobStatus | null => {
        const numeric = Number(value);
        if (numeric === 1)
            return 'SUBMITTED';
        if (numeric === 2)
            return 'QUEUED';
        if (numeric === 3)
            return 'RUNNING';
        if (numeric === 4)
            return 'COMPLETED';
        if (numeric === 5)
            return 'FAILED';
        if (numeric === 6)
            return 'CANCELED';
        if (numeric === 7)
            return 'TIMEOUT';
        const normalized = String(value || '').trim().toUpperCase();
        if (normalized === 'SUBMITTED'
            || normalized === 'QUEUED'
            || normalized === 'RUNNING'
            || normalized === 'COMPLETED'
            || normalized === 'FAILED'
            || normalized === 'CANCELED'
            || normalized === 'TIMEOUT') {
            return normalized;
        }
        return null;
    };
    const toControllerJobSnapshot = (value: unknown): JobPollResult | null => {
        const record = value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};
        const status = normalizeScenarioJobStatus(record.status);
        if (!status) {
            return null;
        }
        const progress = Number(record.progress);
        return {
            status,
            ...(String(record.reasonCode || '').trim()
                ? { reasonCode: String(record.reasonCode || '').trim() }
                : {}),
            ...(String(record.reasonDetail || '').trim()
                ? { reasonDetail: String(record.reasonDetail || '').trim() }
                : {}),
            ...(String(record.traceId || '').trim()
                ? { traceId: String(record.traceId || '').trim() }
                : {}),
            ...(Number.isFinite(progress) ? { progress } : {}),
        };
    };
    const feedControllerJobSnapshot = (jobId: string, value: unknown): void => {
        const snapshot = toControllerJobSnapshot(value);
        if (!snapshot) {
            return;
        }
        if (getJobState(jobId).phase === 'idle') {
            startJobTracking(jobId);
        }
        feedJobEvent(jobId, snapshot);
    };
    const createScenarioJobControllerDeps = (inputValue?: {
        cancelReason?: string;
        captureCancelResponse?: (value: unknown) => void;
        capturePolledJob?: (value: unknown) => void;
    }): JobControllerDeps => ({
        pollJob: async (jobId: string) => {
            const job = await getRuntimeClient().media.jobs.get(jobId);
            inputValue?.capturePolledJob?.(job);
            const snapshot = toControllerJobSnapshot(job);
            if (!snapshot) {
                throw new Error('DESKTOP_SCENARIO_JOB_STATUS_REQUIRED');
            }
            return snapshot;
        },
        cancelJob: async (jobId: string) => {
            const job = await getRuntimeClient().media.jobs.cancel({
                jobId,
                reason: inputValue?.cancelReason,
            });
            inputValue?.captureCancelResponse?.(job);
            const snapshot = toControllerJobSnapshot(job);
            if (!snapshot) {
                throw new Error('DESKTOP_SCENARIO_JOB_STATUS_REQUIRED');
            }
            return {
                status: snapshot.status,
                ...(snapshot.reasonCode ? { reasonCode: snapshot.reasonCode } : {}),
            };
        },
        fetchArtifacts: async (jobId: string) => {
            const artifactsResponse = await getRuntimeClient().media.jobs.getArtifacts(jobId);
            if (!Array.isArray(artifactsResponse.artifacts)) {
                return [];
            }
            return artifactsResponse.artifacts.map((artifact) => ({
                ...(artifact as unknown as Record<string, unknown>),
            }));
        },
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
            getModAiDependencySnapshot: (payload) => hookRuntime.getModAiDependencySnapshot(payload),
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
                    return localAiRuntime.listArtifacts(payload);
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
                            fallback: 'deny',
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
                            fallback: 'deny',
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
                            fallback: 'deny',
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
            media: {
                image: {
                    generate: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.image.generate',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'image.generate',
                            binding,
                        });
                        const preparedResolved = await ensureResolvedLocalModelAvailable(resolved);
                        const model = requireModel(request.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
                        return getRuntimeClient().media.image.generate({
                            ...request,
                            model,
                            route: preparedResolved.source,
                            fallback: 'deny',
                            connectorId: preparedResolved.connectorId || undefined,
                            metadata: {
                                ...(request.metadata || {}),
                                ...(await buildMetadata({
                                    source: preparedResolved.source,
                                    connectorId: preparedResolved.connectorId || undefined,
                                    endpoint: preparedResolved.localProviderEndpoint || preparedResolved.localOpenAiEndpoint || preparedResolved.endpoint,
                                })),
                            },
                        });
                    },
                    stream: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.image.stream',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'image.generate',
                            binding,
                        });
                        const preparedResolved = await ensureResolvedLocalModelAvailable(resolved);
                        const model = requireModel(request.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
                        return getRuntimeClient().media.image.stream({
                            ...request,
                            model,
                            route: preparedResolved.source,
                            fallback: 'deny',
                            connectorId: preparedResolved.connectorId || undefined,
                            metadata: {
                                ...(request.metadata || {}),
                                ...(await buildMetadata({
                                    source: preparedResolved.source,
                                    connectorId: preparedResolved.connectorId || undefined,
                                    endpoint: preparedResolved.localProviderEndpoint || preparedResolved.localOpenAiEndpoint || preparedResolved.endpoint,
                                })),
                            },
                        });
                    },
                },
                video: {
                    generate: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.video.generate',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'video.generate',
                            binding,
                        });
                        return getRuntimeClient().media.video.generate({
                            ...request,
                            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
                            route: resolved.source,
                            fallback: 'deny',
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
                            capabilityKey: 'runtime.media.video.stream',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'video.generate',
                            binding,
                        });
                        return getRuntimeClient().media.video.stream({
                            ...request,
                            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
                            route: resolved.source,
                            fallback: 'deny',
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
                tts: {
                    synthesize: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.tts.synthesize',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'audio.synthesize',
                            binding,
                        });
                        const response = await getRuntimeClient().media.tts.synthesize({
                            ...request,
                            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
                            route: resolved.source,
                            fallback: 'deny',
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
                        return {
                            ...response,
                            artifacts: await cacheSpeechArtifactsForDesktopPlayback({
                                artifacts: response.artifacts,
                                audioFormat: request.audioFormat,
                            }),
                        };
                    },
                    stream: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.tts.stream',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'audio.synthesize',
                            binding,
                        });
                        return getRuntimeClient().media.tts.stream({
                            ...request,
                            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
                            route: resolved.source,
                            fallback: 'deny',
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
                    listVoices: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.tts.list.voices',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'audio.synthesize',
                            binding,
                        });
                        return getRuntimeClient().media.tts.listVoices({
                            ...request,
                            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
                            route: resolved.source,
                            fallback: 'deny',
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
                stt: {
                    transcribe: async (payload) => {
                        const { modId, binding, ...request } = payload;
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.stt.transcribe',
                        });
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability: 'audio.transcribe',
                            binding,
                        });
                        return getRuntimeClient().media.stt.transcribe({
                            ...request,
                            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_STT_MODEL_REQUIRED'),
                            route: resolved.source,
                            fallback: 'deny',
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
                jobs: {
                    submit: async ({ modId, ...payload }) => {
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.jobs.submit',
                        });
                        const binding = payload.input.binding;
                        const capability = payload.modal === 'video'
                            ? 'video.generate'
                            : payload.modal === 'tts'
                                ? 'audio.synthesize'
                                : payload.modal === 'stt'
                                    ? 'audio.transcribe'
                                    : 'image.generate';
                        const resolved = await resolveRuntimeRoute({
                            modId,
                            capability,
                            binding,
                        });
                        const preparedResolved = payload.modal === 'image'
                            ? await ensureResolvedLocalModelAvailable(resolved)
                            : resolved;
                        const metadata = {
                            ...(payload.input.metadata || {}),
                            ...(await buildMetadata({
                                source: preparedResolved.source,
                                connectorId: preparedResolved.connectorId || undefined,
                                endpoint: preparedResolved.localProviderEndpoint || preparedResolved.localOpenAiEndpoint || preparedResolved.endpoint,
                            })),
                        };
                        if (payload.modal === 'image') {
                            const model = requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
                            const job = await getRuntimeClient().media.jobs.submit({
                                modal: 'image',
                                input: {
                                    ...payload.input,
                                    model,
                                    route: preparedResolved.source,
                                    fallback: 'deny',
                                    connectorId: preparedResolved.connectorId || undefined,
                                    metadata,
                                },
                            });
                            const jobId = String((job as unknown as Record<string, unknown>)?.jobId || '').trim();
                            if (jobId) {
                                startJobTracking(jobId);
                                feedControllerJobSnapshot(jobId, job);
                            }
                            return job;
                        }
                        if (payload.modal === 'video') {
                            const job = await getRuntimeClient().media.jobs.submit({
                                modal: 'video',
                                input: {
                                    ...payload.input,
                                    model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
                                    route: preparedResolved.source,
                                    fallback: 'deny',
                                    connectorId: preparedResolved.connectorId || undefined,
                                    metadata,
                                },
                            });
                            const jobId = String((job as unknown as Record<string, unknown>)?.jobId || '').trim();
                            if (jobId) {
                                startJobTracking(jobId);
                                feedControllerJobSnapshot(jobId, job);
                            }
                            return job;
                        }
                        if (payload.modal === 'tts') {
                            const job = await getRuntimeClient().media.jobs.submit({
                                modal: 'tts',
                                input: {
                                    ...payload.input,
                                    model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
                                    route: preparedResolved.source,
                                    fallback: 'deny',
                                    connectorId: preparedResolved.connectorId || undefined,
                                    metadata,
                                },
                            });
                            const jobId = String((job as unknown as Record<string, unknown>)?.jobId || '').trim();
                            if (jobId) {
                                startJobTracking(jobId);
                                feedControllerJobSnapshot(jobId, job);
                            }
                            return job;
                        }
                        const job = await getRuntimeClient().media.jobs.submit({
                            modal: 'stt',
                            input: {
                                ...payload.input,
                                model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_STT_MODEL_REQUIRED'),
                                route: preparedResolved.source,
                                fallback: 'deny',
                                connectorId: preparedResolved.connectorId || undefined,
                                metadata,
                            },
                        });
                        const jobId = String((job as unknown as Record<string, unknown>)?.jobId || '').trim();
                        if (jobId) {
                            startJobTracking(jobId);
                            feedControllerJobSnapshot(jobId, job);
                        }
                        return job;
                    },
                    get: async ({ modId, jobId }) => {
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.jobs.get',
                        });
                        const job = await getRuntimeClient().media.jobs.get(jobId);
                        feedControllerJobSnapshot(jobId, job);
                        return job;
                    },
                    cancel: async ({ modId, jobId, reason }) => {
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.jobs.cancel',
                        });
                        if (getJobState(jobId).phase === 'idle') {
                            startJobTracking(jobId);
                        }
                        let cancelResponse: unknown = null;
                        let polledJob: unknown = null;
                        await requestCancel(jobId, createScenarioJobControllerDeps({
                            cancelReason: reason,
                            captureCancelResponse: (value) => {
                                cancelResponse = value;
                            },
                            capturePolledJob: (value) => {
                                polledJob = value;
                            },
                        }));
                        if (cancelResponse) {
                            return cancelResponse as Awaited<ReturnType<typeof getRuntimeClient>>['media']['jobs'] extends {
                                cancel: (...args: any[]) => Promise<infer T>;
                            }
                                ? T
                                : never;
                        }
                        if (polledJob) {
                            return polledJob as Awaited<ReturnType<typeof getRuntimeClient>>['media']['jobs'] extends {
                                get: (...args: any[]) => Promise<infer T>;
                            }
                                ? T
                                : never;
                        }
                        return getRuntimeClient().media.jobs.get(jobId);
                    },
                    subscribe: async ({ modId, jobId }) => {
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.jobs.subscribe',
                        });
                        if (getJobState(jobId).phase === 'idle') {
                            startJobTracking(jobId);
                        }
                        const stream = await getRuntimeClient().media.jobs.subscribe(jobId);
                        return {
                            async *[Symbol.asyncIterator]() {
                                let sawTerminal = false;
                                try {
                                    for await (const event of stream) {
                                        const record = event && typeof event === 'object' && !Array.isArray(event)
                                            ? event as unknown as Record<string, unknown>
                                            : {};
                                        const snapshot = toControllerJobSnapshot(record.job);
                                        if (snapshot) {
                                            feedJobEvent(jobId, snapshot);
                                            sawTerminal = snapshot.status === 'COMPLETED'
                                                || snapshot.status === 'FAILED'
                                                || snapshot.status === 'CANCELED'
                                                || snapshot.status === 'TIMEOUT';
                                        }
                                        yield event;
                                    }
                                }
                                catch (error) {
                                    const state = getJobState(jobId);
                                    if (state.phase !== 'terminal' && state.phase !== 'recovery_timeout') {
                                        startPollingRecovery(jobId, createScenarioJobControllerDeps());
                                    }
                                    throw error;
                                }
                                const state = getJobState(jobId);
                                if (!sawTerminal && state.phase !== 'terminal' && state.phase !== 'recovery_timeout') {
                                    startPollingRecovery(jobId, createScenarioJobControllerDeps());
                                }
                            },
                        };
                    },
                    getArtifacts: async ({ modId, jobId }) => {
                        authorizeRuntimeCapability({
                            modId,
                            capabilityKey: 'runtime.media.jobs.get.artifacts',
                        });
                        return getRuntimeClient().media.jobs.getArtifacts(jobId);
                    },
                },
            },
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
