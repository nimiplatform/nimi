import { Readable } from 'node:stream';

import { MastraVoice } from '@mastra/core/voice';
import type { ToolsInput, VoiceEventMap } from '@mastra/core/voice';
import {
  runNimiRuntimeSpeechSynthesis,
  runNimiRuntimeSpeechTranscription,
  type NimiRuntimeArtifactClient,
  type NimiRuntimeGenerationHeadInput,
  type NimiRuntimeSpeechTranscriptionAudioSource,
} from '@nimiplatform/sdk/features/generation';
import {
  toNimiRuntimeVoiceReference,
  type NimiRuntimeScenarioJobClient,
  type NimiRuntimeSpeechVoiceReference,
} from '@nimiplatform/sdk/runtime';
import type {
  ListPresetVoicesRequest,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
  RuntimeTypedCallOptions,
  ScenarioArtifact,
} from '@nimiplatform/sdk/runtime/generated';
import {
  VoiceAssetStatus,
  VoiceWorkflowType,
} from '@nimiplatform/sdk/runtime/generated';

export const NIMI_MASTRA_VOICE_UNSUPPORTED_FEATURE_CODE = 'unsupported_mastra_voice_feature' as const;
const NIMI_RUNTIME_SCENARIO_IDEMPOTENCY_KEY_MAX_LENGTH = 256;
type NimiMastraVoiceOperation = 'speak' | 'listen';

export class NimiMastraVoiceUnsupportedFeatureError extends Error {
  readonly code = NIMI_MASTRA_VOICE_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string, detail?: string) {
    super(detail ? `${feature}: ${detail}` : feature);
    this.name = 'NimiMastraVoiceUnsupportedFeatureError';
    this.feature = feature;
  }
}

export interface NimiMastraVoiceScenarioClient extends NimiRuntimeScenarioJobClient {
  listPresetVoices?(request: ListPresetVoicesRequest, options?: RuntimeTypedCallOptions): Promise<ListPresetVoicesResponse>;
  listVoiceAssets?(request: ListVoiceAssetsRequest, options?: RuntimeTypedCallOptions): Promise<ListVoiceAssetsResponse>;
}

export type NimiMastraVoiceRuntime =
  | NimiMastraVoiceScenarioClient
  | {
    readonly ai: NimiMastraVoiceScenarioClient;
    readonly artifacts?: NimiRuntimeArtifactClient;
  };

export type NimiMastraVoiceSpeakerKind = NimiRuntimeSpeechVoiceReference['kind'];

export interface NimiMastraVoiceSpeakOptions {
  readonly speaker?: string;
  readonly speakerKind?: NimiMastraVoiceSpeakerKind;
  readonly voiceRef?: NimiRuntimeSpeechVoiceReference;
  readonly language?: string;
  readonly outputFormat?: string;
  readonly sampleRateHz?: number;
  readonly speed?: number;
  readonly pitch?: number;
  readonly volume?: number;
  readonly emotion?: string;
  readonly timingMode?: 'unspecified' | 'none' | 'word' | 'char';
  readonly providerOptions?: Record<string, unknown>;
  readonly abortSignal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

export interface NimiMastraVoiceListenOptions {
  readonly mediaType?: string;
  readonly language?: string;
  readonly timestamps?: boolean;
  readonly diarization?: boolean;
  readonly speakerCount?: number;
  readonly prompt?: string;
  readonly responseFormat?: string;
  readonly providerOptions?: Record<string, unknown>;
  readonly abortSignal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

export interface NimiMastraVoiceCatalogOptions {
  readonly includePresetVoices?: boolean;
  readonly includeVoiceAssets?: boolean;
  readonly pageSize?: number;
  readonly targetModelId?: string;
  readonly workflowType?: VoiceWorkflowType;
  readonly assetStatus?: VoiceAssetStatus;
}

export interface NimiMastraVoiceOptions {
  readonly runtime: NimiMastraVoiceRuntime;
  readonly head: NimiRuntimeGenerationHeadInput;
  readonly artifacts?: NimiRuntimeArtifactClient;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly defaultVoice?: NimiRuntimeSpeechVoiceReference;
  readonly speakerKind?: NimiMastraVoiceSpeakerKind;
  readonly audioFormat?: string;
  readonly sampleRateHz?: number;
  readonly transcriptionMimeType?: string;
  readonly catalog?: NimiMastraVoiceCatalogOptions;
  readonly requestIdFactory?: (operation: NimiMastraVoiceOperation) => string;
  readonly idempotencyKeyFactory: (operation: NimiMastraVoiceOperation) => string;
}

export interface NimiMastraVoiceSpeakerMetadata {
  readonly name?: string;
  readonly lang?: string;
  readonly supportedLangs?: readonly string[];
  readonly source: 'preset' | 'asset';
  readonly provider?: string;
  readonly modelId?: string;
  readonly previewAudioUri?: string;
  readonly labels?: Readonly<Record<string, string>>;
}

export class NimiMastraVoice extends MastraVoice<
  unknown,
  NimiMastraVoiceSpeakOptions,
  NimiMastraVoiceListenOptions,
  ToolsInput,
  VoiceEventMap,
  NimiMastraVoiceSpeakerMetadata
> {
  private readonly options: NimiMastraVoiceOptions;

  constructor(options: NimiMastraVoiceOptions) {
    if (!options || typeof options.idempotencyKeyFactory !== 'function') {
      throw new NimiMastraVoiceUnsupportedFeatureError(
        'voice.idempotencyKeyFactory',
        'Runtime speech submit idempotency must be caller supplied; the Mastra adapter does not fabricate idempotency keys',
      );
    }
    const modelId = normalizeText(options.head.modelId);
    super({
      name: 'nimi-runtime-voice',
      ...(voiceRefToSpeaker(options.defaultVoice) ? { speaker: voiceRefToSpeaker(options.defaultVoice) } : {}),
      ...(modelId ? { speechModel: { name: modelId }, listeningModel: { name: modelId } } : {}),
    });
    this.options = options;
  }

  async speak(
    input: string | NodeJS.ReadableStream,
    options: NimiMastraVoiceSpeakOptions = {},
  ): Promise<NodeJS.ReadableStream> {
    const text = typeof input === 'string' ? input : await streamToUtf8Text(input);
    const idempotencyKey = requireIdempotencyKey(this.options, 'speak');
    const result = await runNimiRuntimeSpeechSynthesis({
      runtime: getRuntimeAi(this.options.runtime),
      head: this.options.head,
      text,
      voiceRef: toNimiRuntimeVoiceReference(resolveVoiceRef(this.options, options)),
      language: options.language,
      audioFormat: options.outputFormat ?? this.options.audioFormat,
      sampleRateHz: options.sampleRateHz ?? this.options.sampleRateHz,
      speed: options.speed,
      pitch: options.pitch,
      volume: options.volume,
      emotion: options.emotion,
      timingMode: options.timingMode,
      requestId: createRequestId(this.options, 'speak'),
      idempotencyKey,
      callOptions: this.options.callOptions,
      signal: options.abortSignal,
      abortReason: 'mastra_voice_speak_aborted',
    });
    const bytes = await resolveAudioArtifactBytes(result.artifacts[0], this.options);
    return Readable.from([Buffer.from(bytes)]) as NodeJS.ReadableStream;
  }

  async listen(
    audioStream: NodeJS.ReadableStream | unknown,
    options: NimiMastraVoiceListenOptions = {},
  ): Promise<string> {
    const mimeType = normalizeText(options.mediaType ?? this.options.transcriptionMimeType);
    if (!mimeType) {
      throw new NimiMastraVoiceUnsupportedFeatureError(
        'voice.listen',
        'transcription mediaType is required; configure transcriptionMimeType or pass listen({ mediaType })',
      );
    }
    const idempotencyKey = requireIdempotencyKey(this.options, 'listen');
    const result = await runNimiRuntimeSpeechTranscription({
      runtime: getRuntimeAi(this.options.runtime),
      head: this.options.head,
      audio: await toTranscriptionAudioSource(audioStream),
      mimeType,
      language: options.language,
      timestamps: options.timestamps,
      diarization: options.diarization,
      speakerCount: options.speakerCount,
      prompt: options.prompt,
      responseFormat: options.responseFormat,
      requestId: createRequestId(this.options, 'listen'),
      idempotencyKey,
      callOptions: this.options.callOptions,
      signal: options.abortSignal,
      abortReason: 'mastra_voice_listen_aborted',
    });
    return result.text;
  }

  async getSpeakers(): Promise<Array<{ voiceId: string } & NimiMastraVoiceSpeakerMetadata>> {
    const ai = getRuntimeAi(this.options.runtime);
    const catalog = this.options.catalog ?? {};
    if (!ai.listPresetVoices && !ai.listVoiceAssets) {
      return [];
    }
    const speakers: Array<{ voiceId: string } & NimiMastraVoiceSpeakerMetadata> = [];
    if (catalog.includePresetVoices !== false && ai.listPresetVoices) {
      const response = await ai.listPresetVoices(buildListPresetVoicesRequest(this.options, catalog), this.options.callOptions);
      speakers.push(...response.voices.map((voice) => ({
        voiceId: voice.voiceId,
        name: normalizeText(voice.name) || undefined,
        lang: normalizeText(voice.lang) || undefined,
        supportedLangs: voice.supportedLangs,
        source: 'preset' as const,
        previewAudioUri: normalizeText(voice.previewAudioUri) || undefined,
        labels: voice.labels,
      })));
    }
    if (catalog.includeVoiceAssets !== false && ai.listVoiceAssets) {
      const response = await ai.listVoiceAssets(buildListVoiceAssetsRequest(this.options, catalog), this.options.callOptions);
      speakers.push(...response.assets.map((asset) => ({
        voiceId: asset.voiceAssetId,
        source: 'asset' as const,
        provider: normalizeText(asset.provider) || undefined,
        modelId: normalizeText(asset.modelId) || undefined,
      })));
    }
    return speakers;
  }

  async getListener(): Promise<{ enabled: boolean }> {
    return { enabled: true };
  }

  async connect(_options?: Record<string, unknown>): Promise<void> {
    throw new NimiMastraVoiceUnsupportedFeatureError(
      'voice.realtime.connect',
      'Mastra realtime voice is not bound to Nimi Runtime realtime sessions in this adapter',
    );
  }

  async send(_audioData?: NodeJS.ReadableStream | Int16Array): Promise<void> {
    throw new NimiMastraVoiceUnsupportedFeatureError(
      'voice.realtime.send',
      'Mastra realtime voice is not bound to Nimi Runtime realtime sessions in this adapter',
    );
  }

  async answer(_options?: Record<string, unknown>): Promise<void> {
    throw new NimiMastraVoiceUnsupportedFeatureError(
      'voice.realtime.answer',
      'Mastra realtime voice is not bound to Nimi Runtime realtime sessions in this adapter',
    );
  }
}

export function createNimiMastraVoice(options: NimiMastraVoiceOptions): NimiMastraVoice {
  return new NimiMastraVoice(options);
}

async function resolveAudioArtifactBytes(
  artifact: ScenarioArtifact | undefined,
  options: NimiMastraVoiceOptions,
): Promise<Uint8Array> {
  if (!artifact) {
    throw new NimiMastraVoiceUnsupportedFeatureError('voice.speak', 'Runtime speech synthesis returned no audio artifact');
  }
  if (artifact.bytes.length > 0) {
    return artifact.bytes;
  }
  const artifacts = getRuntimeArtifacts(options);
  const artifactId = normalizeText(artifact.artifactId);
  if (artifacts && artifactId) {
    const response = await artifacts.readArtifactBytes({ artifactId }, options.callOptions);
    if (response.bytes.length > 0) {
      return response.bytes;
    }
  }
  throw new NimiMastraVoiceUnsupportedFeatureError(
    'voice.speak',
    'Runtime speech synthesis audio artifact requires inline bytes or Runtime artifact byte reader',
  );
}

function resolveVoiceRef(
  adapterOptions: NimiMastraVoiceOptions,
  speakOptions: NimiMastraVoiceSpeakOptions,
): NimiRuntimeSpeechVoiceReference | undefined {
  if (speakOptions.voiceRef) {
    return speakOptions.voiceRef;
  }
  const speaker = normalizeText(speakOptions.speaker);
  if (speaker) {
    return speakerToVoiceRef(speaker, speakOptions.speakerKind ?? adapterOptions.speakerKind ?? 'preset_voice_id');
  }
  return adapterOptions.defaultVoice;
}

function speakerToVoiceRef(speaker: string, kind: NimiMastraVoiceSpeakerKind): NimiRuntimeSpeechVoiceReference {
  if (kind === 'voice_asset_id') {
    return { kind, voiceAssetId: speaker };
  }
  if (kind === 'provider_voice_ref') {
    return { kind, providerVoiceRef: speaker };
  }
  return { kind: 'preset_voice_id', presetVoiceId: speaker };
}

function buildListPresetVoicesRequest(
  options: NimiMastraVoiceOptions,
  catalog: NimiMastraVoiceCatalogOptions,
): ListPresetVoicesRequest {
  return {
    appId: options.head.appId,
    subjectUserId: normalizeText(options.head.subjectUserId),
    modelId: normalizeText(options.head.modelId),
    targetModelId: normalizeText(catalog.targetModelId),
    connectorId: normalizeText(options.head.connectorId),
  };
}

function buildListVoiceAssetsRequest(
  options: NimiMastraVoiceOptions,
  catalog: NimiMastraVoiceCatalogOptions,
): ListVoiceAssetsRequest {
  return {
    appId: options.head.appId,
    subjectUserId: normalizeText(options.head.subjectUserId),
    modelId: normalizeText(options.head.modelId),
    targetModelId: normalizeText(catalog.targetModelId),
    workflowType: catalog.workflowType ?? VoiceWorkflowType.UNSPECIFIED,
    status: catalog.assetStatus ?? VoiceAssetStatus.UNSPECIFIED,
    pageSize: Number(catalog.pageSize ?? 100),
    pageToken: '',
    connectorId: normalizeText(options.head.connectorId),
  };
}

async function toTranscriptionAudioSource(input: NodeJS.ReadableStream | unknown): Promise<NimiRuntimeSpeechTranscriptionAudioSource> {
  if (input instanceof Uint8Array) {
    return { type: 'bytes', bytes: input };
  }
  if (typeof input === 'string') {
    const text = normalizeText(input);
    if (/^https?:\/\//i.test(text)) {
      return { type: 'url', url: text };
    }
    return { type: 'bytes', bytes: Uint8Array.from(Buffer.from(text, 'base64')) };
  }
  if (isReadableStream(input)) {
    return { type: 'bytes', bytes: await streamToBytes(input) };
  }
  throw new NimiMastraVoiceUnsupportedFeatureError(
    'voice.listen',
    'listen input must be a ReadableStream, Uint8Array, base64 string, or http(s) URL',
  );
}

async function streamToUtf8Text(stream: NodeJS.ReadableStream): Promise<string> {
  return Buffer.from(await streamToBytes(stream)).toString('utf8');
}

async function streamToBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return Boolean(value && typeof value === 'object' && typeof (value as { on?: unknown }).on === 'function');
}

function getRuntimeAi(runtime: NimiMastraVoiceRuntime): NimiMastraVoiceScenarioClient {
  if ('ai' in runtime) {
    return runtime.ai;
  }
  return runtime;
}

function getRuntimeArtifacts(options: NimiMastraVoiceOptions): NimiRuntimeArtifactClient | undefined {
  if (options.artifacts) {
    return options.artifacts;
  }
  if ('ai' in options.runtime) {
    return options.runtime.artifacts;
  }
  return undefined;
}

function createRequestId(
  options: NimiMastraVoiceOptions,
  operation: NimiMastraVoiceOperation,
): string {
  const fromFactory = normalizeText(options.requestIdFactory?.(operation));
  if (fromFactory) {
    return fromFactory;
  }
  return `nimi-mastra-voice-${operation}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requireIdempotencyKey(
  options: NimiMastraVoiceOptions,
  operation: NimiMastraVoiceOperation,
): string {
  const idempotencyKey = normalizeText(options.idempotencyKeyFactory(operation));
  if (!idempotencyKey) {
    throw new NimiMastraVoiceUnsupportedFeatureError(
      `voice.${operation}.idempotencyKey`,
      'idempotencyKeyFactory must return a non-empty Runtime Scenario idempotency key',
    );
  }
  if (idempotencyKey.length > NIMI_RUNTIME_SCENARIO_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new NimiMastraVoiceUnsupportedFeatureError(
      `voice.${operation}.idempotencyKey`,
      `idempotencyKeyFactory returned ${idempotencyKey.length} characters; Runtime Scenario idempotency keys are limited to ${NIMI_RUNTIME_SCENARIO_IDEMPOTENCY_KEY_MAX_LENGTH}`,
    );
  }
  return idempotencyKey;
}

function voiceRefToSpeaker(voiceRef: NimiRuntimeSpeechVoiceReference | undefined): string | undefined {
  if (!voiceRef) {
    return undefined;
  }
  if (voiceRef.kind === 'voice_asset_id') {
    return voiceRef.voiceAssetId;
  }
  if (voiceRef.kind === 'provider_voice_ref') {
    return voiceRef.providerVoiceRef;
  }
  return voiceRef.presetVoiceId;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
