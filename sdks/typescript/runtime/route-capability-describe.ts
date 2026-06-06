import {
  ExecutionMode,
  FallbackPolicy,
  RoutePolicy,
  ScenarioType,
  type ExecuteScenarioRequest,
  type ScenarioSpec,
} from '../core-generated/runtime-typed-client';
import type {
  Struct,
  Value,
} from '../core-generated/runtime-protobuf/google/protobuf/struct';
import { createNimiError, type JsonObject } from '../types';
import {
  normalizeNimiRuntimeRouteModelRoot,
  normalizeRequiredNimiRuntimeRouteCapability,
  normalizeText,
} from './route-capability-binding';
import {
  NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY,
  NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS,
  type NimiRuntimeResolvedBinding,
  type NimiRuntimeRouteDescribeCallOptionsBuilder,
  type NimiRuntimeRouteDescribeResult,
  type NimiRuntimeRouteExecuteScenario,
} from './route-capability-types';
import type { NimiRuntimeCanonicalCapability } from './route-options';

const ROUTE_DESCRIBE_PROBE_TEXT = 'route describe probe';
const ROUTE_DESCRIBE_PROBE_AUDIO_BYTES = new Uint8Array([0]);

function jsonToProtoValue(value: unknown): Value {
  if (value === null) {
    return { kind: { oneofKind: 'nullValue', nullValue: 0 } };
  }
  if (typeof value === 'number') {
    return { kind: { oneofKind: 'numberValue', numberValue: Number.isFinite(value) ? value : 0 } };
  }
  if (typeof value === 'boolean') {
    return { kind: { oneofKind: 'boolValue', boolValue: value } };
  }
  if (typeof value === 'string') {
    return { kind: { oneofKind: 'stringValue', stringValue: value } };
  }
  if (Array.isArray(value)) {
    return { kind: { oneofKind: 'listValue', listValue: { values: value.map(jsonToProtoValue) } } };
  }
  if (value && typeof value === 'object') {
    return { kind: { oneofKind: 'structValue', structValue: toNimiRuntimeProtoStruct(value as JsonObject) } };
  }
  return { kind: { oneofKind: 'stringValue', stringValue: String(value) } };
}

function toNimiRuntimeProtoStruct(value: JsonObject): Struct {
  const fields: Struct['fields'] = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      fields[key] = jsonToProtoValue(entry);
    }
  }
  return { fields };
}

function buildNimiRuntimeRouteDescribeScenarioProbe(input: {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly modelId: string;
}): { readonly scenarioType: ScenarioType; readonly spec: ScenarioSpec; readonly namespace: string } {
  if (input.capability === 'text.generate') {
    return {
      namespace: 'nimi.scenario.text_generate.route_describe',
      scenarioType: ScenarioType.TEXT_GENERATE,
      spec: {
        spec: {
          oneofKind: 'textGenerate',
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
  if (input.capability === 'audio.synthesize') {
    return {
      namespace: 'nimi.scenario.speech_synthesize.route_describe',
      scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
      spec: {
        spec: {
          oneofKind: 'speechSynthesize',
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
  if (input.capability === 'audio.transcribe') {
    return {
      namespace: 'nimi.scenario.speech_transcribe.route_describe',
      scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
      spec: {
        spec: {
          oneofKind: 'speechTranscribe',
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
                oneofKind: 'audioBytes',
                audioBytes: ROUTE_DESCRIBE_PROBE_AUDIO_BYTES,
              },
            },
          },
        },
      },
    };
  }
  if (input.capability === 'voice_workflow.voice_clone') {
    return {
      namespace: 'nimi.scenario.voice_clone.route_describe',
      scenarioType: ScenarioType.VOICE_CLONE,
      spec: {
        spec: {
          oneofKind: 'voiceClone',
          voiceClone: {
            targetModelId: input.modelId,
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
  if (input.capability === 'voice_workflow.voice_design') {
    return {
      namespace: 'nimi.scenario.voice_design.route_describe',
      scenarioType: ScenarioType.VOICE_DESIGN,
      spec: {
        spec: {
          oneofKind: 'voiceDesign',
          voiceDesign: {
            targetModelId: input.modelId,
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
  throw createNimiError({
    message: `Runtime route describe metadata is not implemented for capability ${input.capability}.`,
    reasonCode: 'SDK_RUNTIME_ROUTE_DESCRIBE_UNSUPPORTED',
    actionHint: 'check_runtime_route_capability',
    source: 'sdk',
  });
}

function buildNimiRuntimeRouteDescribeExecuteScenarioRequest(input: {
  readonly appId: string;
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly resolvedBindingRef: string;
  readonly resolved: NimiRuntimeResolvedBinding;
  readonly timeoutMs?: number;
}): ExecuteScenarioRequest {
  const modelId = normalizeNimiRuntimeRouteModelRoot(
    input.resolved.modelId || input.resolved.model || input.resolved.localModelId,
  );
  if (!modelId) {
    throw new Error('NIMI_RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  const probe = buildNimiRuntimeRouteDescribeScenarioProbe({
    capability: input.capability,
    modelId,
  });
  return {
    head: {
      appId: input.appId,
      subjectUserId: '',
      modelId,
      routePolicy: input.resolved.source === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD,
      fallback: FallbackPolicy.DENY,
      timeoutMs: input.timeoutMs ?? NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS,
      connectorId: normalizeText(input.resolved.connectorId),
    },
    scenarioType: probe.scenarioType,
    executionMode: ExecutionMode.SYNC,
    spec: probe.spec,
    extensions: [{
      namespace: probe.namespace,
      payload: toNimiRuntimeProtoStruct({
        version: 'v1',
        resolvedBindingRef: input.resolvedBindingRef,
        localModelId: normalizeText(input.resolved.localModelId) || undefined,
        goRuntimeLocalModelId: normalizeText(input.resolved.goRuntimeLocalModelId) || undefined,
        engine: normalizeText(input.resolved.engine || input.resolved.provider) || undefined,
        modelId,
      }),
    }],
  };
}

function decodeBase64Text(input: string): string {
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(input);
  }
  return Buffer.from(input, 'base64').toString('utf8');
}

function parseNimiRuntimeRouteDescribeMetadata(
  metadataValue: string,
): NimiRuntimeRouteDescribeResult {
  const parsed = JSON.parse(decodeBase64Text(metadataValue)) as Partial<NimiRuntimeRouteDescribeResult>;
  const capability = normalizeRequiredNimiRuntimeRouteCapability(parsed.capability);
  const metadataVersion = parsed.metadataVersion === 'v1' ? 'v1' : null;
  const resolvedBindingRef = normalizeText(parsed.resolvedBindingRef);
  const metadataKind = normalizeText(parsed.metadataKind);
  const metadata = parsed.metadata;
  if (!metadataVersion || !resolvedBindingRef || !metadataKind || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw createNimiError({
      message: 'Runtime route describe metadata is malformed.',
      reasonCode: 'SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_INVALID',
      actionHint: 'check_runtime_route_describe_metadata',
      source: 'sdk',
    });
  }
  return {
    capability,
    metadataVersion,
    resolvedBindingRef,
    metadataKind,
    metadata: metadata as JsonObject,
  };
}

export async function describeNimiRuntimeRouteWithHost(input: {
  readonly appId: string;
  readonly targetId: string;
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly resolvedBindingRef: string;
  readonly resolved: NimiRuntimeResolvedBinding;
  readonly buildCallOptions: NimiRuntimeRouteDescribeCallOptionsBuilder;
  readonly executeScenario: NimiRuntimeRouteExecuteScenario;
  readonly timeoutMs?: number;
}): Promise<NimiRuntimeRouteDescribeResult> {
  const timeoutMs = input.timeoutMs ?? NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS;
  const request = buildNimiRuntimeRouteDescribeExecuteScenarioRequest({
    appId: input.appId,
    capability: input.capability,
    resolvedBindingRef: input.resolvedBindingRef,
    resolved: input.resolved,
    timeoutMs,
  });
  const responseMetadata: Record<string, string> = {};
  const baseOptions = await input.buildCallOptions({
    targetId: input.targetId,
    timeoutMs,
    source: input.resolved.source,
    connectorId: normalizeText(input.resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(
      input.resolved.endpoint || input.resolved.localProviderEndpoint || input.resolved.localOpenAiEndpoint,
    ) || undefined,
  });
  const baseObserver = baseOptions.responseMetadataObserver;
  await input.executeScenario(request, {
    ...baseOptions,
    responseMetadataObserver: (metadata) => {
      Object.assign(responseMetadata, metadata);
      baseObserver?.(metadata);
    },
  });
  const encoded = normalizeText(responseMetadata[NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]);
  if (!encoded) {
    throw createNimiError({
      message: 'Runtime route describe metadata is missing.',
      reasonCode: 'SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_MISSING',
      actionHint: 'check_runtime_route_describe_metadata',
      source: 'sdk',
    });
  }
  const result = parseNimiRuntimeRouteDescribeMetadata(encoded);
  if (result.capability !== input.capability || result.resolvedBindingRef !== input.resolvedBindingRef) {
    throw createNimiError({
      message: 'Runtime route describe metadata does not match the requested route.',
      reasonCode: 'SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_MISMATCH',
      actionHint: 'check_runtime_route_describe_metadata',
      source: 'sdk',
    });
  }
  return result;
}
