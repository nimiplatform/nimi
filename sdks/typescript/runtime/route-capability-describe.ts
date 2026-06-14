import {
  ExecutionMode,
  FallbackPolicy,
  RoutePolicy,
  ScenarioType,
  ToolChoiceMode,
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
  type NimiRuntimeRouteImageGenerateMetadata,
  type NimiRuntimeRouteDescribeCallOptionsBuilder,
  type NimiRuntimeRouteDescribeResult,
  type NimiRuntimeRouteExecuteScenario,
  type NimiRuntimeRouteMetadataKind,
  type NimiRuntimeRouteSpeechSynthesizeMetadata,
  type NimiRuntimeRouteSpeechTimingMode,
  type NimiRuntimeRouteSpeechTranscribeMetadata,
  type NimiRuntimeRouteTextGenerateMetadata,
  type NimiRuntimeRouteTextGenerateTraceModeSupport,
  type NimiRuntimeRouteVoiceWorkflowTextMode,
  type NimiRuntimeRouteVoiceWorkflowVoiceCloneMetadata,
  type NimiRuntimeRouteVoiceWorkflowVoiceDesignMetadata,
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
              toolCalls: [],
              toolCallId: '',
              toolResults: [],
              toolApprovalResponses: [],
            }],
            systemPrompt: '',
            tools: [],
            temperature: 0,
            topP: 0,
            maxTokens: 0,
            toolChoice: ToolChoiceMode.UNSPECIFIED,
            toolChoiceName: '',
            topK: 0,
            presencePenalty: 0,
            frequencyPenalty: 0,
            stop: [],
            seed: '0',
            includeRawChunks: false,
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
  if (input.capability === 'image.generate') {
    return {
      namespace: 'nimi.scenario.image_generate.route_describe',
      scenarioType: ScenarioType.IMAGE_GENERATE,
      spec: {
        spec: {
          oneofKind: 'imageGenerate',
          imageGenerate: {
            prompt: ROUTE_DESCRIBE_PROBE_TEXT,
            negativePrompt: '',
            n: 1,
            size: '',
            aspectRatio: '',
            quality: '',
            style: '',
            seed: '0',
            referenceImages: [],
            mask: '',
            responseFormat: '',
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

const NIMI_RUNTIME_ROUTE_METADATA_KINDS: readonly NimiRuntimeRouteMetadataKind[] = [
  'text.generate',
  'image.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
];

const NIMI_RUNTIME_ROUTE_TEXT_GENERATE_TRACE_MODES: readonly NimiRuntimeRouteTextGenerateTraceModeSupport[] = [
  'none',
  'hide',
  'separate',
];

const NIMI_RUNTIME_ROUTE_SPEECH_TIMING_MODES: readonly NimiRuntimeRouteSpeechTimingMode[] = [
  'none',
  'word',
  'char',
];

const NIMI_RUNTIME_ROUTE_VOICE_WORKFLOW_TEXT_MODES: readonly NimiRuntimeRouteVoiceWorkflowTextMode[] = [
  'unsupported',
  'optional',
  'required',
];

function failNimiRuntimeRouteDescribeMetadata(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_INVALID',
    actionHint: 'check_runtime_route_describe_metadata',
    source: 'sdk',
  });
}

function requireRouteMetadataBoolean(metadata: JsonObject, field: string): boolean {
  const value = metadata[field];
  if (typeof value !== 'boolean') {
    failNimiRuntimeRouteDescribeMetadata(`Runtime route describe metadata field "${field}" must be a boolean.`);
  }
  return value;
}

function requireRouteMetadataStringArray(metadata: JsonObject, field: string): readonly string[] {
  const value = metadata[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    failNimiRuntimeRouteDescribeMetadata(`Runtime route describe metadata field "${field}" must be a string array.`);
  }
  return value as readonly string[];
}

function requireRouteMetadataEnum<T extends string>(
  metadata: JsonObject,
  field: string,
  allowed: readonly T[],
): T {
  const value = metadata[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    failNimiRuntimeRouteDescribeMetadata(
      `Runtime route describe metadata field "${field}" must be one of ${allowed.join(', ')}.`,
    );
  }
  return value as T;
}

function requireRouteMetadataEnumArray<T extends string>(
  metadata: JsonObject,
  field: string,
  allowed: readonly T[],
): readonly T[] {
  const value = metadata[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !allowed.includes(entry as T))) {
    failNimiRuntimeRouteDescribeMetadata(
      `Runtime route describe metadata field "${field}" must be an array of ${allowed.join(', ')}.`,
    );
  }
  return value as readonly T[];
}

function readOptionalRouteMetadataString(metadata: JsonObject, field: string): string | undefined {
  const value = metadata[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    failNimiRuntimeRouteDescribeMetadata(`Runtime route describe metadata field "${field}" must be a string.`);
  }
  return value;
}

function assignOptionalRouteMetadata(
  target: object,
  field: string,
  value: unknown,
): void {
  if (value !== undefined) {
    (target as Record<string, unknown>)[field] = value;
  }
}

function assignProviderExtensionRouteMetadata(
  target: { providerExtensionNamespace?: string; providerExtensionSchemaVersion?: string },
  metadata: JsonObject,
): void {
  assignOptionalRouteMetadata(target, 'providerExtensionNamespace', readOptionalRouteMetadataString(metadata, 'providerExtensionNamespace'));
  assignOptionalRouteMetadata(target, 'providerExtensionSchemaVersion', readOptionalRouteMetadataString(metadata, 'providerExtensionSchemaVersion'));
}

function parseNimiRuntimeRouteTextGenerateMetadata(metadata: JsonObject): NimiRuntimeRouteTextGenerateMetadata {
  return {
    supportsThinking: requireRouteMetadataBoolean(metadata, 'supportsThinking'),
    traceModeSupport: requireRouteMetadataEnum(metadata, 'traceModeSupport', NIMI_RUNTIME_ROUTE_TEXT_GENERATE_TRACE_MODES),
    supportsImageInput: requireRouteMetadataBoolean(metadata, 'supportsImageInput'),
    supportsAudioInput: requireRouteMetadataBoolean(metadata, 'supportsAudioInput'),
    supportsVideoInput: requireRouteMetadataBoolean(metadata, 'supportsVideoInput'),
    supportsArtifactRefInput: requireRouteMetadataBoolean(metadata, 'supportsArtifactRefInput'),
  };
}

function parseNimiRuntimeRouteImageGenerateMetadata(metadata: JsonObject): NimiRuntimeRouteImageGenerateMetadata {
  const maxImagesPerRequest = metadata.maxImagesPerRequest;
  if (typeof maxImagesPerRequest !== 'number' || !Number.isFinite(maxImagesPerRequest) || maxImagesPerRequest <= 0) {
    failNimiRuntimeRouteDescribeMetadata('Runtime route describe metadata field "maxImagesPerRequest" must be a positive finite number.');
  }
  const result: NimiRuntimeRouteImageGenerateMetadata = {
    supportedResponseFormats: requireRouteMetadataStringArray(metadata, 'supportedResponseFormats'),
    maxImagesPerRequest,
    supportsNegativePrompt: requireRouteMetadataBoolean(metadata, 'supportsNegativePrompt'),
    supportsReferenceImages: requireRouteMetadataBoolean(metadata, 'supportsReferenceImages'),
    supportsMask: requireRouteMetadataBoolean(metadata, 'supportsMask'),
    supportsSeed: requireRouteMetadataBoolean(metadata, 'supportsSeed'),
    supportsSize: requireRouteMetadataBoolean(metadata, 'supportsSize'),
    supportsAspectRatio: requireRouteMetadataBoolean(metadata, 'supportsAspectRatio'),
    supportsQuality: requireRouteMetadataBoolean(metadata, 'supportsQuality'),
    supportsStyle: requireRouteMetadataBoolean(metadata, 'supportsStyle'),
  };
  assignOptionalRouteMetadata(result, 'defaultResponseFormat', readOptionalRouteMetadataString(metadata, 'defaultResponseFormat'));
  assignProviderExtensionRouteMetadata(result, metadata);
  return result;
}

function parseNimiRuntimeRouteSpeechSynthesizeMetadata(metadata: JsonObject): NimiRuntimeRouteSpeechSynthesizeMetadata {
  const voiceRenderHints = metadata.voiceRenderHints;
  if (voiceRenderHints !== undefined && (typeof voiceRenderHints !== 'object' || voiceRenderHints === null || Array.isArray(voiceRenderHints))) {
    failNimiRuntimeRouteDescribeMetadata('Runtime route describe metadata field "voiceRenderHints" must be an object.');
  }
  const result: NimiRuntimeRouteSpeechSynthesizeMetadata = {
    supportedAudioFormats: requireRouteMetadataStringArray(metadata, 'supportedAudioFormats'),
    supportedTimingModes: requireRouteMetadataEnumArray(metadata, 'supportedTimingModes', NIMI_RUNTIME_ROUTE_SPEECH_TIMING_MODES),
    supportsLanguage: requireRouteMetadataBoolean(metadata, 'supportsLanguage'),
    supportsEmotion: requireRouteMetadataBoolean(metadata, 'supportsEmotion'),
  };
  assignOptionalRouteMetadata(result, 'defaultAudioFormat', readOptionalRouteMetadataString(metadata, 'defaultAudioFormat'));
  assignOptionalRouteMetadata(result, 'voiceRenderHints', voiceRenderHints as NimiRuntimeRouteSpeechSynthesizeMetadata['voiceRenderHints']);
  assignProviderExtensionRouteMetadata(result, metadata);
  return result;
}

function parseNimiRuntimeRouteSpeechTranscribeMetadata(metadata: JsonObject): NimiRuntimeRouteSpeechTranscribeMetadata {
  const maxSpeakerCount = metadata.maxSpeakerCount;
  if (maxSpeakerCount !== undefined && (typeof maxSpeakerCount !== 'number' || !Number.isFinite(maxSpeakerCount))) {
    failNimiRuntimeRouteDescribeMetadata('Runtime route describe metadata field "maxSpeakerCount" must be a finite number.');
  }
  const result: NimiRuntimeRouteSpeechTranscribeMetadata = {
    tiers: requireRouteMetadataStringArray(metadata, 'tiers'),
    supportedResponseFormats: requireRouteMetadataStringArray(metadata, 'supportedResponseFormats'),
    supportsLanguage: requireRouteMetadataBoolean(metadata, 'supportsLanguage'),
    supportsPrompt: requireRouteMetadataBoolean(metadata, 'supportsPrompt'),
    supportsTimestamps: requireRouteMetadataBoolean(metadata, 'supportsTimestamps'),
    supportsDiarization: requireRouteMetadataBoolean(metadata, 'supportsDiarization'),
  };
  assignOptionalRouteMetadata(result, 'maxSpeakerCount', maxSpeakerCount as number | undefined);
  assignProviderExtensionRouteMetadata(result, metadata);
  return result;
}

function parseNimiRuntimeRouteVoiceCloneMetadata(metadata: JsonObject): NimiRuntimeRouteVoiceWorkflowVoiceCloneMetadata {
  const result: NimiRuntimeRouteVoiceWorkflowVoiceCloneMetadata = {
    workflowType: requireRouteMetadataEnum(metadata, 'workflowType', ['voice_clone'] as const),
    requiresTargetSynthesisBinding: requireRouteMetadataBoolean(metadata, 'requiresTargetSynthesisBinding'),
    textPromptMode: requireRouteMetadataEnum(metadata, 'textPromptMode', NIMI_RUNTIME_ROUTE_VOICE_WORKFLOW_TEXT_MODES),
    supportsLanguageHints: requireRouteMetadataBoolean(metadata, 'supportsLanguageHints'),
    supportsPreferredName: requireRouteMetadataBoolean(metadata, 'supportsPreferredName'),
    referenceAudioUriInput: requireRouteMetadataBoolean(metadata, 'referenceAudioUriInput'),
    referenceAudioBytesInput: requireRouteMetadataBoolean(metadata, 'referenceAudioBytesInput'),
    allowedReferenceAudioMimeTypes: requireRouteMetadataStringArray(metadata, 'allowedReferenceAudioMimeTypes'),
  };
  assignProviderExtensionRouteMetadata(result, metadata);
  return result;
}

function parseNimiRuntimeRouteVoiceDesignMetadata(metadata: JsonObject): NimiRuntimeRouteVoiceWorkflowVoiceDesignMetadata {
  const result: NimiRuntimeRouteVoiceWorkflowVoiceDesignMetadata = {
    workflowType: requireRouteMetadataEnum(metadata, 'workflowType', ['voice_design'] as const),
    requiresTargetSynthesisBinding: requireRouteMetadataBoolean(metadata, 'requiresTargetSynthesisBinding'),
    instructionTextMode: requireRouteMetadataEnum(metadata, 'instructionTextMode', NIMI_RUNTIME_ROUTE_VOICE_WORKFLOW_TEXT_MODES),
    previewTextMode: requireRouteMetadataEnum(metadata, 'previewTextMode', NIMI_RUNTIME_ROUTE_VOICE_WORKFLOW_TEXT_MODES),
    supportsLanguage: requireRouteMetadataBoolean(metadata, 'supportsLanguage'),
    supportsPreferredName: requireRouteMetadataBoolean(metadata, 'supportsPreferredName'),
  };
  assignProviderExtensionRouteMetadata(result, metadata);
  return result;
}

function parseNimiRuntimeRouteDescribeMetadata(
  metadataValue: string,
): NimiRuntimeRouteDescribeResult {
  const parsed = JSON.parse(decodeBase64Text(metadataValue)) as {
    readonly capability?: unknown;
    readonly metadataVersion?: unknown;
    readonly resolvedBindingRef?: unknown;
    readonly metadataKind?: unknown;
    readonly metadata?: unknown;
  };
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
  if (!NIMI_RUNTIME_ROUTE_METADATA_KINDS.includes(metadataKind as NimiRuntimeRouteMetadataKind)) {
    throw createNimiError({
      message: `Runtime route describe metadataKind "${metadataKind}" is not a supported route metadata kind.`,
      reasonCode: 'SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_KIND_UNSUPPORTED',
      actionHint: 'check_runtime_route_describe_metadata',
      source: 'sdk',
    });
  }
  const base = { capability, metadataVersion, resolvedBindingRef } as const;
  const metadataObject = metadata as JsonObject;
  switch (metadataKind as NimiRuntimeRouteMetadataKind) {
    case 'text.generate':
      return { ...base, metadataKind: 'text.generate', metadata: parseNimiRuntimeRouteTextGenerateMetadata(metadataObject) };
    case 'image.generate':
      return { ...base, metadataKind: 'image.generate', metadata: parseNimiRuntimeRouteImageGenerateMetadata(metadataObject) };
    case 'audio.synthesize':
      return { ...base, metadataKind: 'audio.synthesize', metadata: parseNimiRuntimeRouteSpeechSynthesizeMetadata(metadataObject) };
    case 'audio.transcribe':
      return { ...base, metadataKind: 'audio.transcribe', metadata: parseNimiRuntimeRouteSpeechTranscribeMetadata(metadataObject) };
    case 'voice_workflow.voice_clone':
      return { ...base, metadataKind: 'voice_workflow.voice_clone', metadata: parseNimiRuntimeRouteVoiceCloneMetadata(metadataObject) };
    case 'voice_workflow.voice_design':
      return { ...base, metadataKind: 'voice_workflow.voice_design', metadata: parseNimiRuntimeRouteVoiceDesignMetadata(metadataObject) };
  }
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
  if (
    result.capability !== input.capability
    || result.metadataKind !== input.capability
    || result.resolvedBindingRef !== input.resolvedBindingRef
  ) {
    throw createNimiError({
      message: 'Runtime route describe metadata does not match the requested route.',
      reasonCode: 'SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_MISMATCH',
      actionHint: 'check_runtime_route_describe_metadata',
      source: 'sdk',
    });
  }
  return result;
}
