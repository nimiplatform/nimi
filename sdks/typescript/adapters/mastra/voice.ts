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

export const NIMI_MASTRA_VOICE_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;
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

export type NimiMastraVoiceReference =
  | { readonly kind: 'preset_voice_id'; readonly presetVoiceId: string }
  | { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string };

export type NimiMastraVoiceSpeakerKind = NimiMastraVoiceReference['kind'];

export interface NimiMastraVoiceSpeakOptions {
  readonly speaker?: string;
  readonly speakerKind?: NimiMastraVoiceSpeakerKind;
  readonly voiceRef?: NimiMastraVoiceReference;
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
  readonly workflowType?: VoiceWorkflowType;
  readonly assetStatus?: VoiceAssetStatus;
}

export interface NimiMastraVoiceOptions {
  readonly runtime: NimiMastraVoiceRuntime;
  readonly head: NimiRuntimeGenerationHeadInput;
  readonly artifacts?: NimiRuntimeArtifactClient;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly defaultVoice?: NimiMastraVoiceReference;
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
    const defaultSpeaker = voiceRefToSpeaker(options.defaultVoice, 'voice.defaultVoice');
    super({
      name: 'nimi-runtime-voice',
      ...(defaultSpeaker ? { speaker: defaultSpeaker } : {}),
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
      const response = await ai.listPresetVoices(buildListPresetVoicesRequest(this.options), this.options.callOptions);
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
): NimiMastraVoiceReference | undefined {
  if (speakOptions.voiceRef) {
    return normalizeVoiceReference(speakOptions.voiceRef, 'voice.speak.voiceRef');
  }
  const speaker = normalizeText(speakOptions.speaker);
  if (speaker) {
    const kind = normalizeSpeakerKind(
      speakOptions.speakerKind ?? adapterOptions.speakerKind ?? 'preset_voice_id',
      'voice.speak.speakerKind',
    );
    return speakerToVoiceRef(speaker, kind);
  }
  return adapterOptions.defaultVoice
    ? normalizeVoiceReference(adapterOptions.defaultVoice, 'voice.defaultVoice')
    : undefined;
}

function speakerToVoiceRef(speaker: string, kind: NimiMastraVoiceSpeakerKind): NimiMastraVoiceReference {
  if (kind === 'voice_asset_id') {
    return { kind, voiceAssetId: speaker };
  }
  return { kind: 'preset_voice_id', presetVoiceId: speaker };
}

function buildListPresetVoicesRequest(
  options: NimiMastraVoiceOptions,
): ListPresetVoicesRequest {
  return {
    appId: options.head.appId,
    subjectUserId: normalizeText(options.head.subjectUserId),
  } as ListPresetVoicesRequest;
}

function buildListVoiceAssetsRequest(
  options: NimiMastraVoiceOptions,
  catalog: NimiMastraVoiceCatalogOptions,
): ListVoiceAssetsRequest {
  return {
    appId: options.head.appId,
    subjectUserId: normalizeText(options.head.subjectUserId),
    workflowType: catalog.workflowType ?? VoiceWorkflowType.UNSPECIFIED,
    status: catalog.assetStatus ?? VoiceAssetStatus.UNSPECIFIED,
    pageSize: Number(catalog.pageSize ?? 100),
    pageToken: '',
  } as ListVoiceAssetsRequest;
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

function voiceRefToSpeaker(
  voiceRef: NimiMastraVoiceReference | undefined,
  feature: string,
): string | undefined {
  if (!voiceRef) {
    return undefined;
  }
  const normalized = normalizeVoiceReference(voiceRef, feature);
  return normalized.kind === 'voice_asset_id' ? normalized.voiceAssetId : normalized.presetVoiceId;
}

function normalizeVoiceReference(
  voiceRef: NimiMastraVoiceReference,
  feature: string,
): NimiMastraVoiceReference {
  if (!voiceRef || typeof voiceRef !== 'object' || Array.isArray(voiceRef)) {
    throw new NimiMastraVoiceUnsupportedFeatureError(feature, 'voice reference must be an object');
  }
  const keys = Object.keys(voiceRef).sort();
  if (voiceRef.kind === 'preset_voice_id'
    && keys.length === 2
    && keys[0] === 'kind'
    && keys[1] === 'presetVoiceId') {
    const presetVoiceId = normalizeText(voiceRef.presetVoiceId);
    if (presetVoiceId) return { kind: 'preset_voice_id', presetVoiceId };
  }
  if (voiceRef.kind === 'voice_asset_id'
    && keys.length === 2
    && keys[0] === 'kind'
    && keys[1] === 'voiceAssetId') {
    const voiceAssetId = normalizeText(voiceRef.voiceAssetId);
    if (voiceAssetId) return { kind: 'voice_asset_id', voiceAssetId };
  }
  throw new NimiMastraVoiceUnsupportedFeatureError(
    feature,
    'ordinary voice references must be exactly preset_voice_id or voice_asset_id',
  );
}

function normalizeSpeakerKind(value: unknown, feature: string): NimiMastraVoiceSpeakerKind {
  if (value === 'preset_voice_id' || value === 'voice_asset_id') {
    return value;
  }
  throw new NimiMastraVoiceUnsupportedFeatureError(
    feature,
    'speakerKind must be preset_voice_id or voice_asset_id',
  );
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
