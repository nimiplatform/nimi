import {
  decodeRuntimeRouteDescribeResultFromMetadata,
  resolveRuntimeRouteBindingFromSnapshot,
  type RuntimeCanonicalCapability,
  type RuntimeResolvedBinding,
  type RuntimeRouteBinding,
  type RuntimeRouteDescribeResult,
  type RuntimeRouteHealthResult,
} from '@nimiplatform/sdk/ai';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
  toProtoStruct,
  type Runtime,
} from '@nimiplatform/sdk/runtime';
import {
  setConversationCapabilityRouteRuntime,
  type ConversationCapability,
  type ConversationCapabilityRouteRuntime,
} from '@renderer/features/chat/conversation-capability';
import {
  buildRuntimeCallOptions,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  checkLocalLlmHealth,
} from '@runtime/llm-adapter/execution/health-check';
import type {
  CheckLlmHealthInput,
  ProviderHealth,
} from '@runtime/llm-adapter/execution/types';
import {
  loadRuntimeRouteOptions,
} from './runtime-bootstrap-route-options';

const ROUTE_DESCRIBE_TIMEOUT_MS = 30_000;
const ROUTE_DESCRIBE_PROBE_TEXT = 'route describe probe';
const ROUTE_DESCRIBE_PROBE_AUDIO_BYTES = new Uint8Array([0]);

type RuntimeClient = Pick<Runtime, 'appId' | 'ai'>;

type RuntimeCallOptionsWithObserver = Awaited<ReturnType<typeof buildRuntimeCallOptions>> & {
  _responseMetadataObserver?: (metadata: Record<string, string>) => void;
};

type DesktopConversationCapabilityRouteRuntimeDeps = {
  loadRuntimeRouteOptions: typeof loadRuntimeRouteOptions;
  checkLocalLlmHealth: typeof checkLocalLlmHealth;
  buildRuntimeCallOptions: typeof buildRuntimeCallOptions;
  getRuntimeClient: () => RuntimeClient;
};

const DEFAULT_DEPS: DesktopConversationCapabilityRouteRuntimeDeps = {
  loadRuntimeRouteOptions,
  checkLocalLlmHealth,
  buildRuntimeCallOptions,
  getRuntimeClient,
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toHealthResult(
  resolved: RuntimeResolvedBinding,
  health: ProviderHealth,
): RuntimeRouteHealthResult {
  const available = health.status === 'healthy' || health.status === 'degraded';
  return {
    healthy: available,
    status: available ? health.status : 'unavailable',
    provider: normalizeText(health.provider || resolved.provider),
    detail: normalizeText(health.detail),
    actionHint: available
      ? 'none'
      : (resolved.source === 'cloud' ? 'verify-connector' : 'install-local-model'),
  };
}

function describeSpecForCapability(
  capability: RuntimeCanonicalCapability,
  modelId: string,
): {
  namespace: string;
  scenarioType: ScenarioType;
  spec: Parameters<Runtime['ai']['executeScenario']>[0]['spec'];
} {
  if (capability === 'text.generate') {
    return {
      namespace: 'nimi.scenario.text_generate.route_describe',
      scenarioType: ScenarioType.TEXT_GENERATE,
      spec: {
        spec: {
          oneofKind: 'textGenerate' as const,
          textGenerate: {
            input: [{
              role: 'user',
              content: ROUTE_DESCRIBE_PROBE_TEXT,
              name: '',
              parts: [],
            }],
            systemPrompt: '',
            tools: [],
            temperature: 0,
            topP: 0,
            maxTokens: 0,
          },
        },
      },
    };
  }
  if (capability === 'audio.synthesize') {
    return {
      namespace: 'nimi.scenario.speech_synthesize.route_describe',
      scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
      spec: {
        spec: {
          oneofKind: 'speechSynthesize' as const,
          speechSynthesize: {
            text: ROUTE_DESCRIBE_PROBE_TEXT,
            audioFormat: 'mp3',
            language: '',
            sampleRateHz: 0,
            speed: 0,
            pitch: 0,
            volume: 0,
            emotion: '',
            timingMode: 3,
          },
        },
      },
    };
  }
  if (capability === 'audio.transcribe') {
    return {
      namespace: 'nimi.scenario.speech_transcribe.route_describe',
      scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
      spec: {
        spec: {
          oneofKind: 'speechTranscribe' as const,
          speechTranscribe: {
            mimeType: 'audio/wav',
            language: '',
            timestamps: false,
            diarization: false,
            speakerCount: 0,
            prompt: '',
            responseFormat: 'json',
            audioSource: {
              source: {
                oneofKind: 'audioBytes' as const,
                audioBytes: ROUTE_DESCRIBE_PROBE_AUDIO_BYTES,
              },
            },
          },
        },
      },
    };
  }
  if (capability === 'voice_workflow.voice_clone') {
    return {
      namespace: 'nimi.scenario.voice_clone.route_describe',
      scenarioType: ScenarioType.VOICE_CLONE,
      spec: {
        spec: {
          oneofKind: 'voiceClone' as const,
          voiceClone: {
            targetModelId: modelId,
            input: {
              referenceAudioBytes: ROUTE_DESCRIBE_PROBE_AUDIO_BYTES,
              referenceAudioMime: 'audio/wav',
              referenceAudioUri: '',
              text: '',
              preferredName: 'route-describe-probe',
              languageHints: [],
            },
          },
        },
      },
    };
  }
  if (capability === 'voice_workflow.voice_design') {
    return {
      namespace: 'nimi.scenario.voice_design.route_describe',
      scenarioType: ScenarioType.VOICE_DESIGN,
      spec: {
        spec: {
          oneofKind: 'voiceDesign' as const,
          voiceDesign: {
            targetModelId: modelId,
            input: {
              instructionText: ROUTE_DESCRIBE_PROBE_TEXT,
              previewText: ROUTE_DESCRIBE_PROBE_TEXT,
              language: '',
              preferredName: 'route-describe-probe',
            },
          },
        },
      },
    };
  }
  throw new Error('RUNTIME_ROUTE_DESCRIBE_METADATA_MISSING');
}

function toHealthInput(resolved: RuntimeResolvedBinding): CheckLlmHealthInput {
  return {
    provider: normalizeText(resolved.provider || resolved.engine),
    capability: resolved.capability,
    localProviderEndpoint: normalizeText(resolved.localProviderEndpoint || resolved.endpoint) || undefined,
    localProviderModel: normalizeText(resolved.modelId || resolved.model || resolved.localModelId) || undefined,
    localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint || resolved.endpoint) || undefined,
    localModelId: normalizeText(resolved.localModelId) || undefined,
    goRuntimeLocalModelId: normalizeText(resolved.goRuntimeLocalModelId || resolved.localModelId) || undefined,
    connectorId: normalizeText(resolved.connectorId) || undefined,
  };
}

export function createDesktopConversationCapabilityRouteRuntime(
  depsInput: Partial<DesktopConversationCapabilityRouteRuntimeDeps> = {},
): ConversationCapabilityRouteRuntime {
  const deps = { ...DEFAULT_DEPS, ...depsInput };
  const resolvedByRef = new Map<string, RuntimeResolvedBinding>();

  async function resolve(input: {
    capability: ConversationCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<RuntimeResolvedBinding> {
    if (!input.binding) {
      throw new Error('RUNTIME_ROUTE_BINDING_REQUIRED');
    }
    const capability = input.capability as RuntimeCanonicalCapability;
    const snapshot = await deps.loadRuntimeRouteOptions({ capability });
    const resolved = resolveRuntimeRouteBindingFromSnapshot({
      capability,
      binding: input.binding,
      snapshot,
    });
    if (resolved.resolvedBindingRef) {
      resolvedByRef.set(resolved.resolvedBindingRef, resolved);
    }
    return resolved;
  }

  return {
    resolve,
    checkHealth: async (input) => {
      const resolved = await resolve(input);
      const health = await deps.checkLocalLlmHealth(toHealthInput(resolved));
      return toHealthResult(resolved, health);
    },
    describe: async (input): Promise<RuntimeRouteDescribeResult> => {
      const capability = input.capability as RuntimeCanonicalCapability;
      const resolvedBindingRef = normalizeText(input.resolvedBindingRef);
      const resolved = resolvedByRef.get(resolvedBindingRef);
      if (!resolved) {
        throw new Error('RUNTIME_ROUTE_DESCRIBE_BINDING_REF_MISSING');
      }
      const runtime = deps.getRuntimeClient();
      const modelId = normalizeText(resolved.modelId || resolved.model || resolved.localModelId);
      if (!modelId) {
        throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
      }
      const describe = describeSpecForCapability(capability, modelId);
      const payload = toProtoStruct({
        version: 'v1',
        resolvedBindingRef,
        localModelId: normalizeText(resolved.localModelId) || undefined,
        goRuntimeLocalModelId: normalizeText(resolved.goRuntimeLocalModelId) || undefined,
        engine: normalizeText(resolved.engine || resolved.provider) || undefined,
        modelId,
      });
      if (!payload) {
        throw new Error('RUNTIME_ROUTE_DESCRIBE_PAYLOAD_INVALID');
      }
      const responseMetadata: Record<string, string> = {};
      const callOptions: RuntimeCallOptionsWithObserver = {
        ...(await deps.buildRuntimeCallOptions({
          targetId: 'core.chat.agent',
          timeoutMs: ROUTE_DESCRIBE_TIMEOUT_MS,
          source: resolved.source,
          connectorId: normalizeText(resolved.connectorId) || undefined,
          providerEndpoint: normalizeText(resolved.endpoint || resolved.localProviderEndpoint || resolved.localOpenAiEndpoint) || undefined,
        })),
        _responseMetadataObserver: (metadata) => {
          Object.assign(responseMetadata, metadata);
        },
      };
      await runtime.ai.executeScenario({
        head: {
          appId: runtime.appId,
          modelId,
          routePolicy: resolved.source === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD,
          timeoutMs: ROUTE_DESCRIBE_TIMEOUT_MS,
          connectorId: normalizeText(resolved.connectorId),
        },
        scenarioType: describe.scenarioType,
        executionMode: ExecutionMode.SYNC,
        spec: describe.spec,
        extensions: [{
          namespace: describe.namespace,
          payload,
        }],
      }, callOptions as Parameters<Runtime['ai']['executeScenario']>[1]);
      return decodeRuntimeRouteDescribeResultFromMetadata({
        metadata: responseMetadata,
        expectedCapability: capability,
        expectedResolvedBindingRef: resolvedBindingRef,
      });
    },
  };
}

export function bindDesktopConversationCapabilityRouteRuntime(
  deps?: Partial<DesktopConversationCapabilityRouteRuntimeDeps>,
): void {
  setConversationCapabilityRouteRuntime(createDesktopConversationCapabilityRouteRuntime(deps));
}

export function clearDesktopConversationCapabilityRouteRuntime(): void {
  setConversationCapabilityRouteRuntime(null);
}
