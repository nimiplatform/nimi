/**
 * Mod SDK V2 Basics
 *
 * Run: npx tsx examples/mods/mod-basic.ts
 */
import { clearModSdkHost, setModSdkHost } from '../../nimi-mods/shared/testing/mod-sdk-host.js';
import { createHookClient, createModRuntimeClient, type ModSdkHost, type RuntimeCanonicalCapability, type RuntimeRouteBinding, type RuntimeRouteOptionsSnapshot } from "@nimiplatform/sdk/mod";
const MOD_ID = 'world.nimi.my-mod';
type HookEventHandler = (payload: unknown) => Promise<void> | void;
type DataProviderHandler = (query: unknown) => Promise<unknown> | unknown;
type TurnHookHandler = (context: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
type InterModHandler = (payload: unknown) => Promise<unknown> | unknown;
const textBinding: RuntimeRouteBinding = {
    source: 'cloud',
    connectorId: 'connector-demo-chat',
    model: 'nimillm/demo-chat',
};
const ttsBinding: RuntimeRouteBinding = {
    source: 'cloud',
    connectorId: 'connector-demo-tts',
    model: 'elevenlabs/demo-tts',
};
const routeOptionsByCapability = new Map<RuntimeCanonicalCapability, RuntimeRouteOptionsSnapshot>([
    ['text.generate', {
            capability: 'text.generate',
            selected: textBinding,
            resolvedDefault: textBinding,
            local: { models: [] },
            connectors: [{
                    id: textBinding.connectorId,
                    label: 'Demo Chat Connector',
                    vendor: 'nimillm',
                    models: [textBinding.model],
                    modelCapabilities: {
                        [textBinding.model]: ['text.generate'],
                    },
                }],
        }],
    ['audio.synthesize', {
            capability: 'audio.synthesize',
            selected: ttsBinding,
            resolvedDefault: ttsBinding,
            local: { models: [] },
            connectors: [{
                    id: ttsBinding.connectorId,
                    label: 'Demo TTS Connector',
                    vendor: 'elevenlabs',
                    models: [ttsBinding.model],
                    modelCapabilities: {
                        [ttsBinding.model]: ['audio.synthesize'],
                    },
                }],
        }],
]);
function writeLine(line: string): void {
    process.stdout.write(`${line}\n`);
}
function cloneValue<T>(value: T): T {
    return structuredClone(value);
}
function createMockHost() {
    const eventHandlers = new Map<string, HookEventHandler[]>();
    const dataProviders = new Map<string, DataProviderHandler>();
    const uiExtensions = new Map<string, Array<Record<string, unknown>>>();
    const turnHooks = new Map<string, TurnHookHandler[]>();
    const interModHandlers = new Map<string, InterModHandler>();
    const runtimeHook = {
        subscribeEvent: async (input: {
            topic: string;
            handler: HookEventHandler;
            once?: boolean;
        }) => {
            const handlers = eventHandlers.get(input.topic) || [];
            if (input.once) {
                handlers.push(async (payload: unknown) => {
                    await input.handler(payload);
                    eventHandlers.set(input.topic, (eventHandlers.get(input.topic) || []).filter((handler) => handler !== input.handler));
                });
            }
            else {
                handlers.push(input.handler);
            }
            eventHandlers.set(input.topic, handlers);
        },
        unsubscribeEvent: (input: {
            topic?: string;
        }) => {
            if (!input.topic) {
                return;
            }
            eventHandlers.delete(input.topic);
        },
        publishEvent: async (input: {
            topic: string;
            payload: unknown;
        }) => {
            for (const handler of eventHandlers.get(input.topic) || []) {
                await handler(input.payload);
            }
        },
        listEventTopics: () => Array.from(eventHandlers.keys()).sort(),
        queryData: async (input: {
            capability: string;
            query: unknown;
        }) => {
            const handler = dataProviders.get(input.capability);
            if (!handler) {
                return { items: [] };
            }
            return await handler(input.query);
        },
        registerDataProvider: async (input: {
            capability: string;
            handler: DataProviderHandler;
        }) => {
            dataProviders.set(input.capability, input.handler);
        },
        unregisterDataProvider: (input: {
            capability?: string;
        }) => {
            if (!input.capability) {
                return;
            }
            dataProviders.delete(input.capability);
        },
        listDataCapabilities: () => Array.from(dataProviders.keys()).sort(),
        registerUIExtensionV2: async (input: {
            slot: string;
            extension: Record<string, unknown>;
        }) => {
            const extensions = uiExtensions.get(input.slot) || [];
            extensions.push(cloneValue(input.extension));
            uiExtensions.set(input.slot, extensions);
        },
        unregisterUIExtension: (input: {
            slot?: string;
        }) => {
            if (!input.slot) {
                return;
            }
            uiExtensions.delete(input.slot);
        },
        resolveUIExtensions: (slot: string) => cloneValue(uiExtensions.get(slot) || []),
        listUISlots: () => Array.from(uiExtensions.keys()).sort(),
        registerTurnHookV2: async (input: {
            point: string;
            handler: TurnHookHandler;
        }) => {
            const handlers = turnHooks.get(input.point) || [];
            handlers.push(input.handler);
            turnHooks.set(input.point, handlers);
        },
        unregisterTurnHook: (input: {
            point?: string;
        }) => {
            if (!input.point) {
                return;
            }
            turnHooks.delete(input.point);
        },
        invokeTurnHooks: async (input: {
            point: string;
            context: Record<string, unknown>;
        }) => {
            let next = cloneValue(input.context);
            for (const handler of turnHooks.get(input.point) || []) {
                next = await handler(next);
            }
            return next;
        },
        registerInterModHandlerV2: async (input: {
            channel: string;
            handler: InterModHandler;
        }) => {
            interModHandlers.set(input.channel, input.handler);
        },
        unregisterInterModHandler: (input: {
            channel?: string;
        }) => {
            if (!input.channel) {
                return;
            }
            interModHandlers.delete(input.channel);
        },
        requestInterMod: async (input: {
            channel: string;
            payload: unknown;
        }) => {
            const handler = interModHandlers.get(input.channel);
            if (!handler) {
                throw new Error(`INTER_MOD_HANDLER_NOT_FOUND:${input.channel}`);
            }
            return await handler(input.payload);
        },
        broadcastInterMod: async (input: {
            channel: string;
            payload: unknown;
        }) => {
            const handler = interModHandlers.get(input.channel);
            if (!handler) {
                return [];
            }
            return [await handler(input.payload)];
        },
        discoverInterModChannels: () => Array.from(interModHandlers.keys()).sort(),
    };
    return {
        runtime: {
            checkLocalLlmHealth: async () => ({
                ok: true,
                routeSource: 'cloud',
                availableModels: [textBinding.model, ttsBinding.model],
            }),
            executeLocalKernelTurn: async () => ({
                text: 'Local kernel turn is not part of this example.',
                traceId: 'trace-demo-kernel',
            }),
            withOpenApiContextLock: async (_context: Parameters<ModSdkHost['runtime']['withOpenApiContextLock']>[0], task: Parameters<ModSdkHost['runtime']['withOpenApiContextLock']>[1]) => await task(),
            getRuntimeHookRuntime: () => runtimeHook as never,
            getModAiDependencySnapshot: async () => ({
                modId: MOD_ID,
                status: 'ready',
                routeSource: 'mixed',
                warnings: [],
                dependencies: [],
                repairActions: [],
                updatedAt: '2026-03-06T00:00:00Z',
            }),
            local: {
                listArtifacts: async () => [],
            },
            route: {
                listOptions: async (input: Parameters<ModSdkHost['runtime']['route']['listOptions']>[0]) => {
                    const snapshot = routeOptionsByCapability.get(input.capability);
                    if (!snapshot) {
                        throw new Error(`ROUTE_OPTIONS_NOT_FOUND:${input.capability}`);
                    }
                    return cloneValue(snapshot);
                },
                resolve: async (input: Parameters<ModSdkHost['runtime']['route']['resolve']>[0]) => {
                    const snapshot = routeOptionsByCapability.get(input.capability);
                    const binding = input.binding || snapshot?.selected;
                    if (!binding) {
                        throw new Error(`ROUTE_BINDING_NOT_FOUND:${input.capability}`);
                    }
                    return {
                        capability: input.capability,
                        source: binding.source,
                        provider: binding.source === 'local' ? 'local' : 'nimillm',
                        model: binding.model,
                        connectorId: binding.connectorId,
                        adapter: binding.model.startsWith('elevenlabs/') ? 'elevenlabs' : 'openai_compatible',
                    };
                },
                checkHealth: async (input: Parameters<ModSdkHost['runtime']['route']['checkHealth']>[0]) => ({
                    ok: true,
                    capability: input.capability,
                    binding: input.binding || routeOptionsByCapability.get(input.capability)?.selected,
                    providerHealthy: true,
                    routeAvailable: true,
                    warnings: [],
                }) as never,
            },
            ai: {
                text: {
                    generate: async (input: Parameters<ModSdkHost['runtime']['ai']['text']['generate']>[0]) => ({
                        text: `Demo answer for model=${input.model || textBinding.model}`,
                        finishReason: 'stop',
                        usage: {
                            inputTokens: 12,
                            outputTokens: 16,
                            totalTokens: 28,
                        },
                        trace: {
                            traceId: 'trace-demo-text',
                            modelResolved: input.model || textBinding.model,
                            routeDecision: 'cloud',
                        },
                    }),
                    stream: async (input: Parameters<ModSdkHost['runtime']['ai']['text']['stream']>[0]) => ({
                        stream: (async function* () {
                            yield { type: 'start' as const };
                            yield { type: 'delta' as const, text: 'Hello ' };
                            yield { type: 'delta' as const, text: `from ${input.model || textBinding.model}` };
                            yield {
                                type: 'finish' as const,
                                finishReason: 'stop' as const,
                                usage: {
                                    inputTokens: 4,
                                    outputTokens: 5,
                                    totalTokens: 9,
                                },
                                trace: {
                                    traceId: 'trace-demo-stream',
                                    modelResolved: input.model || textBinding.model,
                                    routeDecision: 'cloud' as const,
                                },
                            };
                        })(),
                    }),
                },
                embedding: {
                    generate: async () => ({
                        vectors: [[0.1, 0.2, 0.3]],
                        usage: { inputTokens: 3, totalTokens: 3 },
                        trace: {
                            traceId: 'trace-demo-embed',
                            modelResolved: 'nimillm/demo-embed',
                            routeDecision: 'cloud',
                        },
                    }),
                },
            },
            media: {
                image: {
                    generate: async () => {
                        throw new Error('IMAGE_DEMO_NOT_IMPLEMENTED');
                    },
                    stream: async () => {
                        throw new Error('IMAGE_DEMO_NOT_IMPLEMENTED');
                    },
                },
                video: {
                    generate: async () => {
                        throw new Error('VIDEO_DEMO_NOT_IMPLEMENTED');
                    },
                    stream: async () => {
                        throw new Error('VIDEO_DEMO_NOT_IMPLEMENTED');
                    },
                },
                tts: {
                    listVoices: async (input: Parameters<ModSdkHost['runtime']['media']['tts']['listVoices']>[0]) => ({
                        voices: [
                            {
                                voiceId: 'voice-demo-1',
                                name: 'Demo Voice',
                                lang: 'en-US',
                                supportedLangs: ['en-US'],
                            },
                        ],
                        modelResolved: input.model || ttsBinding.model,
                        traceId: 'trace-demo-voices',
                        voiceCatalogSource: 'builtin_snapshot',
                        voiceCatalogVersion: 'demo-v1',
                        voiceCount: 1,
                    }),
                    synthesize: async (input: Parameters<ModSdkHost['runtime']['media']['tts']['synthesize']>[0]) => ({
                        job: {
                            jobId: 'job-demo-tts',
                            status: 4,
                            traceId: 'trace-demo-tts',
                            routeDecision: 2,
                            modelResolved: input.model || ttsBinding.model,
                        } as never,
                        artifacts: [{
                                artifactId: 'artifact-demo-tts',
                                mimeType: 'audio/mpeg',
                                bytes: new Uint8Array(Buffer.from('demo-audio')),
                                traceId: 'trace-demo-tts',
                                metadata: {
                                    voiceId: input.voice || 'voice-demo-1',
                                },
                            }] as never,
                        trace: {
                            traceId: 'trace-demo-tts',
                            modelResolved: input.model || ttsBinding.model,
                            routeDecision: 'cloud',
                        },
                    }),
                    stream: async () => (async function* () {
                        yield {
                            artifactId: 'artifact-demo-tts',
                            mimeType: 'audio/mpeg',
                            chunk: new Uint8Array(Buffer.from('demo-audio')),
                            eof: true,
                            traceId: 'trace-demo-tts-stream',
                        } as never;
                    })(),
                },
                stt: {
                    transcribe: async () => ({
                        job: {
                            jobId: 'job-demo-stt',
                            status: 4,
                            traceId: 'trace-demo-stt',
                            routeDecision: 2,
                            modelResolved: 'demo-stt',
                        } as never,
                        text: 'Transcribed demo text.',
                        trace: {
                            traceId: 'trace-demo-stt',
                            modelResolved: 'demo-stt',
                            routeDecision: 'cloud',
                        },
                    }),
                },
                jobs: {
                    submit: async () => ({
                        jobId: 'job-demo',
                        status: 1,
                        traceId: 'trace-demo-job',
                        routeDecision: 2,
                        modelResolved: 'demo-model',
                    }) as never,
                    get: async () => ({
                        jobId: 'job-demo',
                        status: 4,
                        traceId: 'trace-demo-job',
                        routeDecision: 2,
                        modelResolved: 'demo-model',
                    }) as never,
                    cancel: async () => ({
                        jobId: 'job-demo',
                        status: 6,
                        traceId: 'trace-demo-job',
                        routeDecision: 2,
                        modelResolved: 'demo-model',
                    }) as never,
                    subscribe: async () => (async function* () { })(),
                    getArtifacts: async () => ({
                        artifacts: [],
                        traceId: 'trace-demo-job',
                    }),
                },
            },
            voice: {
                getAsset: async () => ({ asset: undefined, traceId: 'trace-demo-voice' }) as never,
                listAssets: async () => ({ assets: [], nextPageToken: '', traceId: 'trace-demo-voice' }) as never,
                deleteAsset: async () => ({ deleted: true, traceId: 'trace-demo-voice' }) as never,
                listPresetVoices: async () => ({
                    voices: [],
                    modelResolved: ttsBinding.model,
                    traceId: 'trace-demo-voice',
                }) as never,
            },
        },
        ui: {
            useAppStore: () => {
                throw new Error('UI_DEMO_NOT_AVAILABLE');
            },
            SlotHost: (() => null) as never,
            useUiExtensionContext: () => ({
                isAuthenticated: true,
                activeTab: 'mods',
                setActiveTab: () => { },
                runtimeFields: {},
                setRuntimeFields: () => { },
            }),
        },
        logging: {
            emitRuntimeLog: () => { },
            createRendererFlowId: (prefix: Parameters<ModSdkHost['logging']['createRendererFlowId']>[0]) => `${prefix}-demo-flow`,
            logRendererEvent: () => { },
        },
    };
}
async function registerHooks() {
    const hook = createHookClient(MOD_ID);
    await hook.event.subscribe({
        topic: 'chat.message.created',
        handler: async (payload) => {
            writeLine(`[event] chat.message.created -> ${JSON.stringify(payload)}`);
        },
    });
    await hook.event.publish({
        topic: 'chat.message.created',
        payload: { messageId: 'msg-demo-1', text: 'hello from mock host' },
    });
    await hook.data.register({
        capability: 'data-api.user-math-quiz.sessions.list',
        handler: async (query) => ({
            items: [
                { id: 'session-1', date: '2026-03-06', score: 92 },
                { id: 'session-2', date: '2026-03-05', score: 88 },
            ],
            query,
        }),
    });
    const sessions = await hook.data.query({
        capability: 'data-api.user-math-quiz.sessions.list',
        query: { limit: 7 },
    });
    writeLine(`[data] sessions -> ${JSON.stringify(sessions)}`);
    await hook.ui.register({
        slot: 'ui-extension.app.sidebar.mods',
        priority: 10,
        extension: {
            extensionId: 'ui-extension.app.sidebar.mods:world.nimi.my-mod:10',
            strategy: 'append',
            title: 'Math Quiz',
            route: '/mods/math-quiz',
        },
    });
    const sidebarExtensions = hook.ui.resolve('ui-extension.app.sidebar.mods');
    writeLine(`[ui] sidebar extensions -> ${JSON.stringify(sidebarExtensions)}`);
    await hook.turn.register({
        point: 'pre-model',
        priority: 5,
        handler: async (context) => ({
            ...context,
            moderated: true,
        }),
    });
    const turnContext = await hook.turn.invoke({
        point: 'pre-model',
        context: { prompt: 'Generate 5 grade-3 daily math questions.' },
    });
    writeLine(`[turn] pre-model -> ${JSON.stringify(turnContext)}`);
    await hook.interMod.registerHandler({
        channel: 'math-quiz.request',
        handler: async (payload) => ({
            ok: true,
            received: payload,
        }),
    });
    const interModResponse = await hook.interMod.request({
        toModId: 'world.nimi.teacher-assistant',
        channel: 'math-quiz.request',
        payload: { grade: 3, count: 10 },
    });
    writeLine(`[inter-mod] response -> ${JSON.stringify(interModResponse)}`);
}
async function useRuntimeFacade() {
    const runtime = createModRuntimeClient(MOD_ID);
    const textRoutes = await runtime.route.listOptions({ capability: 'text.generate' });
    const textBindingResolved = await runtime.route.resolve({
        capability: 'text.generate',
        binding: textRoutes.selected,
    });
    writeLine(`[route] text.generate -> ${JSON.stringify(textBindingResolved)}`);
    const textResult = await runtime.ai.text.generate({
        binding: textRoutes.selected,
        model: textRoutes.selected.model,
        input: 'Generate 5 grade-3 daily math questions.',
        system: 'Return concise JSON.',
        temperature: 0.2,
        maxTokens: 256,
    });
    writeLine(`[runtime.ai.text.generate] ${textResult.text}`);
    const streamed = await runtime.ai.text.stream({
        binding: textRoutes.selected,
        model: textRoutes.selected.model,
        input: 'Say hello in one short sentence.',
    });
    process.stdout.write('[runtime.ai.text.stream] ');
    for await (const event of streamed.stream) {
        if (event.type === 'delta') {
            process.stdout.write(event.text);
        }
    }
    process.stdout.write('\n');
    const ttsRoutes = await runtime.route.listOptions({ capability: 'audio.synthesize' });
    const voices = await runtime.media.tts.listVoices({
        binding: ttsRoutes.selected,
        model: ttsRoutes.selected.model,
    });
    writeLine(`[runtime.media.tts.listVoices] ${JSON.stringify(voices.voices)}`);
    const speech = await runtime.media.tts.synthesize({
        binding: ttsRoutes.selected,
        model: ttsRoutes.selected.model,
        voice: voices.voices[0]?.voiceId,
        text: 'Hello from the runtime-aligned mod example.',
    });
    writeLine(`[runtime.media.tts.synthesize] artifact-bytes=${speech.artifacts[0]?.bytes.length || 0}`);
}
async function main() {
    setModSdkHost(createMockHost());
    try {
        await registerHooks();
        await useRuntimeFacade();
    }
    finally {
        clearModSdkHost();
    }
}
await main();
