import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  ImageModelV3,
  ImageModelV3CallOptions,
  ImageModelV3ProviderMetadata,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
} from '@ai-sdk/provider';
import {
  asNimiError,
  createNimiError,
  type RuntimeCallOptions,
  type RuntimeClient,
  type RuntimeStreamCallOptions,
} from '../runtime/index.js';
import { Struct } from '../runtime/generated/google/protobuf/struct.js';
import { ReasonCode, type AiFallbackPolicy, type AiRoutePolicy } from '../types/index.js';

const ROUTE_POLICY_LOCAL_RUNTIME = 1;
const ROUTE_POLICY_TOKEN_API = 2;
const FALLBACK_POLICY_DENY = 1;
const FALLBACK_POLICY_ALLOW = 2;
const MODAL_TEXT = 1;
const MODAL_IMAGE = 2;
const MODAL_VIDEO = 3;
const MODAL_TTS = 4;
const MODAL_STT = 5;
const MEDIA_JOB_STATUS_COMPLETED = 4;
const MEDIA_JOB_STATUS_FAILED = 5;
const MEDIA_JOB_STATUS_CANCELED = 6;
const MEDIA_JOB_STATUS_TIMEOUT = 7;

type RuntimeDefaults = {
  appId: string;
  subjectUserId: string;
  routePolicy: AiRoutePolicy;
  fallback: AiFallbackPolicy;
  timeoutMs?: number;
  metadata?: RuntimeCallOptions['metadata'];
};

export type NimiAiProviderConfig = {
  runtime: RuntimeClient;
  appId: string;
  subjectUserId: string;
  routePolicy?: AiRoutePolicy;
  fallback?: AiFallbackPolicy;
  timeoutMs?: number;
  metadata?: RuntimeCallOptions['metadata'];
};

export type NimiRuntimeVideoModel = {
  generate(options: {
    prompt: string;
    negativePrompt?: string;
    durationSec?: number;
    fps?: number;
    resolution?: string;
    aspectRatio?: string;
    seed?: number;
    providerOptions?: Record<string, unknown>;
    routePolicy?: AiRoutePolicy;
    fallback?: AiFallbackPolicy;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<NimiArtifactGenerationResult>;
};

export type NimiRuntimeSpeechModel = {
  synthesize(options: {
    text: string;
    voice?: string;
    language?: string;
    audioFormat?: string;
    sampleRateHz?: number;
    speed?: number;
    pitch?: number;
    volume?: number;
    providerOptions?: Record<string, unknown>;
    routePolicy?: AiRoutePolicy;
    fallback?: AiFallbackPolicy;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<NimiArtifactGenerationResult>;
};

export type NimiRuntimeTranscriptionModel = {
  transcribe(options: {
    audioBytes?: Uint8Array;
    audioUrl?: string;
    mimeType?: string;
    language?: string;
    timestamps?: boolean;
    diarization?: boolean;
    speakerCount?: number;
    prompt?: string;
    providerOptions?: Record<string, unknown>;
    routePolicy?: AiRoutePolicy;
    fallback?: AiFallbackPolicy;
    timeoutMs?: number;
  }): Promise<{
    text: string;
    traceId: string;
    routeDecision: AiRoutePolicy;
    modelResolved: string;
  }>;
};

export type NimiArtifact = {
  artifactId: string;
  mimeType: string;
  bytes: Uint8Array;
  traceId: string;
  routeDecision: AiRoutePolicy;
  modelResolved: string;
};

export type NimiArtifactGenerationResult = {
  artifacts: NimiArtifact[];
};

export type NimiAiProvider = ((modelId: string) => LanguageModelV3) & {
  text(modelId: string): LanguageModelV3;
  embedding(modelId: string): EmbeddingModelV3;
  image(modelId: string): ImageModelV3;
  video(modelId: string): NimiRuntimeVideoModel;
  tts(modelId: string): NimiRuntimeSpeechModel;
  stt(modelId: string): NimiRuntimeTranscriptionModel;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

function parseCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

function resolveRoutePolicy(value: AiRoutePolicy | undefined): number {
  return value === 'token-api'
    ? ROUTE_POLICY_TOKEN_API
    : ROUTE_POLICY_LOCAL_RUNTIME;
}

function resolveFallbackPolicy(value: AiFallbackPolicy | undefined): number {
  return value === 'allow'
    ? FALLBACK_POLICY_ALLOW
    : FALLBACK_POLICY_DENY;
}

function fromRouteDecision(value: unknown): AiRoutePolicy {
  return Number(value) === ROUTE_POLICY_TOKEN_API ? 'token-api' : 'local-runtime';
}

function toProviderMetadata(input: {
  traceId?: string;
  routeDecision?: unknown;
  modelResolved?: string;
}): SharedV3ProviderMetadata {
  return {
    nimi: {
      traceId: normalizeText(input.traceId) || undefined,
      routeDecision: fromRouteDecision(input.routeDecision),
      modelResolved: normalizeText(input.modelResolved) || undefined,
    },
  };
}

function toUsage(value: unknown): LanguageModelV3Usage {
  const usage = (value && typeof value === 'object')
    ? value as { inputTokens?: unknown; outputTokens?: unknown }
    : {};
  const inputTokens = parseCount(usage.inputTokens);
  const outputTokens = parseCount(usage.outputTokens);
  return {
    inputTokens: {
      total: inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: undefined,
    },
  };
}

function toFinishReason(value: unknown): LanguageModelV3FinishReason {
  const reason = Number(value);
  switch (reason) {
    case 1:
      return { unified: 'stop', raw: 'STOP' };
    case 2:
      return { unified: 'length', raw: 'LENGTH' };
    case 3:
      return { unified: 'tool-calls', raw: 'TOOL_CALL' };
    case 4:
      return { unified: 'content-filter', raw: 'CONTENT_FILTER' };
    case 5:
      return { unified: 'error', raw: 'ERROR' };
    default:
      return { unified: 'other', raw: undefined };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function extractTextValue(part: unknown): string {
  const record = asRecord(part);
  if (record.type === 'text') {
    return normalizeText(record.text);
  }
  if (record.type === 'reasoning') {
    return normalizeText(record.text);
  }
  if (record.type === 'tool-result') {
    return normalizeText(JSON.stringify(record.result || null));
  }
  return '';
}

function toRuntimePrompt(prompt: LanguageModelV3Prompt): {
  systemPrompt: string;
  input: Array<{
    role: string;
    content: string;
    name: string;
  }>;
} {
  const system: string[] = [];
  const input: Array<{
    role: string;
    content: string;
    name: string;
  }> = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      const text = normalizeText(message.content);
      if (text) {
        system.push(text);
      }
      continue;
    }

    const content = Array.isArray(message.content)
      ? message.content.map(extractTextValue).filter((text: string) => text.length > 0).join('\n')
      : '';
    if (!content) {
      continue;
    }

    input.push({
      role: message.role,
      content,
      name: '',
    });
  }

  return {
    systemPrompt: system.join('\n\n'),
    input,
  };
}

function extractGenerateText(output: unknown): string {
  const fields = asRecord(asRecord(output).fields);
  const text = asRecord(fields.text);
  const kind = asRecord(text.kind);

  if (kind.oneofKind === 'stringValue') {
    return normalizeText(kind.stringValue);
  }
  if (typeof text.stringValue === 'string') {
    return normalizeText(text.stringValue);
  }
  return '';
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function toBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64');
  }
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    output += String.fromCharCode(value[index] || 0);
  }
  if (typeof btoa === 'function') {
    return btoa(output);
  }
  throw createNimiError({
    message: 'base64 encoder unavailable',
    reasonCode: ReasonCode.SDK_AI_PROVIDER_BASE64_UNAVAILABLE,
    actionHint: 'use_node_or_tauri_runtime',
    source: 'sdk',
  });
}

function toUtf8(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('utf8');
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(value);
  }
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    output += String.fromCharCode(value[index] || 0);
  }
  return output;
}

function toProtoStruct(input: Record<string, unknown> | undefined): any {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return Struct.fromJson(input as unknown as object);
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type MediaJobExecution = {
  artifacts: NimiArtifact[];
  traceId: string;
  routeDecision: AiRoutePolicy;
  modelResolved: string;
};

async function executeMediaJob(
  runtime: RuntimeClient,
  defaults: RuntimeDefaults,
  request: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MediaJobExecution> {
  const submitResponse = await runtime.ai.submitMediaJob(
    request as never,
    toCallOptions(defaults, {
      timeoutMs,
      metadata: undefined,
    }),
  );
  const initialJob = asRecord(submitResponse.job);
  const jobId = ensureText(initialJob.jobId, 'jobId');
  const startedAt = Date.now();
  const maxWaitMs = timeoutMs > 0 ? timeoutMs : 120000;

  while (true) {
    if (signal?.aborted) {
      throw createNimiError({
        message: 'media job aborted',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_media_job_request',
        source: 'sdk',
      });
    }

    const jobResponse = await runtime.ai.getMediaJob(
      { jobId } as never,
      toCallOptions(defaults, { timeoutMs }),
    );
    const job = asRecord(jobResponse.job);
    const status = Number(job.status || 0);
    if (status === MEDIA_JOB_STATUS_COMPLETED) {
      const artifactsResponse = await runtime.ai.getMediaArtifacts(
        { jobId } as never,
        toCallOptions(defaults, { timeoutMs }),
      );
      const artifacts = Array.isArray(artifactsResponse.artifacts)
        ? artifactsResponse.artifacts
        : [];
      const traceId = normalizeText(artifactsResponse.traceId) || normalizeText(job.traceId);
      const routeDecision = fromRouteDecision(job.routeDecision);
      const modelResolved = normalizeText(job.modelResolved) || normalizeText(request.modelId);

      return {
        artifacts: artifacts.map((item) => {
          const record = asRecord(item);
          const bytes = record.bytes instanceof Uint8Array
            ? record.bytes
            : new Uint8Array(0);
          return {
            artifactId: normalizeText(record.artifactId),
            mimeType: normalizeText(record.mimeType),
            bytes,
            traceId,
            routeDecision,
            modelResolved,
          };
        }),
        traceId,
        routeDecision,
        modelResolved,
      };
    }
    if (
      status === MEDIA_JOB_STATUS_FAILED
      || status === MEDIA_JOB_STATUS_CANCELED
      || status === MEDIA_JOB_STATUS_TIMEOUT
    ) {
      const reasonCode = normalizeText(job.reasonCode) || ReasonCode.AI_PROVIDER_UNAVAILABLE;
      throw createNimiError({
        message: normalizeText(job.reasonDetail) || `media job failed: ${reasonCode}`,
        reasonCode,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }
    if ((Date.now() - startedAt) > maxWaitMs) {
      throw createNimiError({
        message: 'media job timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }
    await sleep(250);
  }
}

function ensureRuntime(config: NimiAiProviderConfig): {
  runtime: RuntimeClient;
  defaults: RuntimeDefaults;
} {
  if (!config.runtime || !config.runtime.ai) {
    throw createNimiError({
      message: 'createNimiAiProvider requires runtime client',
      reasonCode: ReasonCode.SDK_AI_PROVIDER_RUNTIME_REQUIRED,
      actionHint: 'provide_runtime_client',
      source: 'sdk',
    });
  }

  return {
    runtime: config.runtime,
    defaults: {
      appId: ensureText(config.appId, 'appId'),
      subjectUserId: ensureText(config.subjectUserId, 'subjectUserId'),
      routePolicy: config.routePolicy || 'local-runtime',
      fallback: config.fallback || 'deny',
      timeoutMs: config.timeoutMs,
      metadata: config.metadata,
    },
  };
}

function toCallOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
  },
): RuntimeCallOptions {
  const timeoutMs = typeof input.timeoutMs === 'number'
    ? input.timeoutMs
    : defaults.timeoutMs;
  const metadata = {
    ...(defaults.metadata || {}),
    ...(input.metadata || {}),
  };

  return {
    timeoutMs,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function toStreamOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
    signal?: AbortSignal;
  },
): RuntimeStreamCallOptions {
  return {
    ...toCallOptions(defaults, input),
    signal: input.signal,
  };
}

async function collectArtifacts(stream: AsyncIterable<unknown>): Promise<NimiArtifact[]> {
  const order: string[] = [];
  const states = new Map<string, {
    artifactId: string;
    mimeType: string;
    chunks: Uint8Array[];
    traceId: string;
    routeDecision: AiRoutePolicy;
    modelResolved: string;
  }>();

  for await (const item of stream) {
    const chunk = asRecord(item);
    const artifactId = normalizeText(chunk.artifactId) || `artifact-${order.length + 1}`;
    const state = states.get(artifactId) || {
      artifactId,
      mimeType: '',
      chunks: [],
      traceId: '',
      routeDecision: 'local-runtime' as const,
      modelResolved: '',
    };

    if (!states.has(artifactId)) {
      states.set(artifactId, state);
      order.push(artifactId);
    }

    const mimeType = normalizeText(chunk.mimeType);
    if (mimeType) {
      state.mimeType = mimeType;
    }

    const traceId = normalizeText(chunk.traceId);
    if (traceId) {
      state.traceId = traceId;
    }

    const modelResolved = normalizeText(chunk.modelResolved);
    if (modelResolved) {
      state.modelResolved = modelResolved;
    }

    state.routeDecision = fromRouteDecision(chunk.routeDecision);

    const bytes = chunk.chunk;
    if (bytes instanceof Uint8Array) {
      state.chunks.push(bytes);
    } else if (bytes instanceof ArrayBuffer) {
      state.chunks.push(new Uint8Array(bytes));
    } else if (Array.isArray(bytes)) {
      state.chunks.push(Uint8Array.from(bytes.map((value) => Number(value) || 0)));
    }
  }

  return order.map((artifactId) => {
    const state = states.get(artifactId);
    if (!state) {
      return {
        artifactId,
        mimeType: '',
        bytes: new Uint8Array(0),
        traceId: '',
        routeDecision: 'local-runtime' as const,
        modelResolved: '',
      };
    }
    return {
      artifactId: state.artifactId,
      mimeType: state.mimeType,
      bytes: concatChunks(state.chunks),
      traceId: state.traceId,
      routeDecision: state.routeDecision,
      modelResolved: state.modelResolved,
    };
  });
}

function toEmbeddingVectors(vectors: unknown): number[][] {
  const list = Array.isArray(vectors) ? vectors : [];
  return list.map((entry) => {
    const values = Array.isArray(asRecord(entry).values)
      ? asRecord(entry).values as unknown[]
      : [];
    return values
      .map((value) => {
        const kind = asRecord(asRecord(value).kind);
        if (kind.oneofKind === 'numberValue') {
          const n = Number(kind.numberValue);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      })
      .filter((value): value is number => value !== null);
  });
}

function normalizeProviderError(error: unknown) {
  return asNimiError(error, {
    reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
    actionHint: 'check_runtime_and_route_policy',
    source: 'runtime',
  });
}

function createLanguageModel(
  runtime: RuntimeClient,
  defaults: RuntimeDefaults,
  modelId: string,
): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId,
    supportedUrls: {},
    doGenerate: async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
      try {
        const prompt = toRuntimePrompt(options.prompt);
        if (prompt.input.length === 0) {
          throw createNimiError({
            message: 'language model prompt must include at least one non-system text message',
            reasonCode: ReasonCode.AI_INPUT_INVALID,
            actionHint: 'add_user_or_assistant_text_message',
            source: 'sdk',
          });
        }

        const response = await runtime.ai.generate({
          appId: defaults.appId,
          subjectUserId: defaults.subjectUserId,
          modelId,
          modal: MODAL_TEXT,
          input: prompt.input,
          systemPrompt: prompt.systemPrompt,
          tools: [],
          temperature: options.temperature || 0,
          topP: options.topP || 0,
          maxTokens: options.maxOutputTokens || 0,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs: defaults.timeoutMs || 0,
        }, toCallOptions(defaults, {
          timeoutMs: defaults.timeoutMs,
        }));

        return {
          content: [{
            type: 'text',
            text: extractGenerateText(response.output),
          }],
          finishReason: toFinishReason(response.finishReason),
          usage: toUsage(response.usage),
          warnings: [],
          providerMetadata: toProviderMetadata({
            traceId: response.traceId,
            routeDecision: response.routeDecision,
            modelResolved: response.modelResolved,
          }),
          response: {
            id: normalizeText(response.traceId) || undefined,
            modelId: normalizeText(response.modelResolved) || modelId,
          },
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
    doStream: async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
      try {
        const prompt = toRuntimePrompt(options.prompt);
        if (prompt.input.length === 0) {
          throw createNimiError({
            message: 'language model prompt must include at least one non-system text message',
            reasonCode: ReasonCode.AI_INPUT_INVALID,
            actionHint: 'add_user_or_assistant_text_message',
            source: 'sdk',
          });
        }

        const runtimeStream = await runtime.ai.streamGenerate({
          appId: defaults.appId,
          subjectUserId: defaults.subjectUserId,
          modelId,
          modal: MODAL_TEXT,
          input: prompt.input,
          systemPrompt: prompt.systemPrompt,
          tools: [],
          temperature: options.temperature || 0,
          topP: options.topP || 0,
          maxTokens: options.maxOutputTokens || 0,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs: defaults.timeoutMs || 0,
        }, toStreamOptions(defaults, {
          timeoutMs: defaults.timeoutMs,
          signal: options.abortSignal,
        }));

        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            void (async () => {
              const textId = 'nimi-text-1';
              let textOpen = false;
              controller.enqueue({
                type: 'stream-start',
                warnings: [],
              });

              for await (const event of runtimeStream) {
                const payload = asRecord(event).payload;
                const oneofKind = normalizeText(asRecord(payload).oneofKind);
                if (oneofKind === 'delta') {
                  const delta = normalizeText(asRecord(asRecord(payload).delta).text);
                  if (!delta) {
                    continue;
                  }
                  if (!textOpen) {
                    textOpen = true;
                    controller.enqueue({
                      type: 'text-start',
                      id: textId,
                    });
                  }
                  controller.enqueue({
                    type: 'text-delta',
                    id: textId,
                    delta,
                  });
                  continue;
                }

                if (oneofKind === 'failed') {
                  controller.enqueue({
                    type: 'error',
                    error: createNimiError({
                      message: normalizeText(asRecord(asRecord(payload).failed).actionHint) || 'runtime stream failed',
                      reasonCode: normalizeText(asRecord(asRecord(payload).failed).reasonCode) || 'AI_STREAM_BROKEN',
                      actionHint: 'retry_or_switch_route',
                      source: 'runtime',
                    }),
                  });
                  continue;
                }

                if (oneofKind === 'completed') {
                  if (textOpen) {
                    controller.enqueue({
                      type: 'text-end',
                      id: textId,
                    });
                    textOpen = false;
                  }
                  controller.enqueue({
                    type: 'finish',
                    finishReason: toFinishReason(
                      asRecord(asRecord(payload).completed).finishReason,
                    ),
                    usage: toUsage(asRecord(event).usage),
                    providerMetadata: toProviderMetadata({
                      traceId: normalizeText(asRecord(event).traceId) || undefined,
                      routeDecision: asRecord(event).routeDecision,
                      modelResolved: normalizeText(asRecord(event).modelResolved) || undefined,
                    }),
                  });
                }
              }

              if (textOpen) {
                controller.enqueue({
                  type: 'text-end',
                  id: textId,
                });
              }
              controller.close();
            })().catch((error) => {
              controller.enqueue({
                type: 'error',
                error: normalizeProviderError(error),
              });
              controller.close();
            });
          },
        });

        return { stream };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

function createEmbeddingModel(
  runtime: RuntimeClient,
  defaults: RuntimeDefaults,
  modelId: string,
): EmbeddingModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId,
    maxEmbeddingsPerCall: undefined,
    supportsParallelCalls: true,
    doEmbed: async (options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> => {
      try {
        const response = await runtime.ai.embed({
          appId: defaults.appId,
          subjectUserId: defaults.subjectUserId,
          modelId,
          inputs: options.values,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs: defaults.timeoutMs || 0,
        }, toCallOptions(defaults, {
          timeoutMs: defaults.timeoutMs,
          metadata: undefined,
        }));

        return {
          embeddings: toEmbeddingVectors(response.vectors),
          usage: {
            tokens: parseCount(asRecord(response.usage).inputTokens) || 0,
          },
          warnings: [],
          providerMetadata: toProviderMetadata({
            traceId: response.traceId,
            routeDecision: response.routeDecision,
            modelResolved: response.modelResolved,
          }),
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

function createImageModel(
  runtime: RuntimeClient,
  defaults: RuntimeDefaults,
  modelId: string,
): ImageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId,
    maxImagesPerCall: undefined,
    doGenerate: async (options: ImageModelV3CallOptions) => {
      try {
        const timeoutMs = defaults.timeoutMs || 0;
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          subjectUserId: defaults.subjectUserId,
          modelId,
          modal: MODAL_IMAGE,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs,
          spec: {
            oneofKind: 'imageSpec',
            imageSpec: {
              prompt: normalizeText(options.prompt),
            },
          },
        }, timeoutMs, options.abortSignal);
        const artifacts = media.artifacts;
        const providerMetadata = {
          nimi: {
            images: artifacts.map((artifact) => ({
              artifactId: artifact.artifactId,
              mimeType: artifact.mimeType,
              traceId: artifact.traceId,
            })),
          },
        } as unknown as ImageModelV3ProviderMetadata;

        return {
          images: artifacts.map((artifact) => toBase64(artifact.bytes)),
          warnings: [],
          providerMetadata,
          response: {
            timestamp: new Date(),
            modelId,
            headers: undefined,
          },
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

function createVideoModel(
  runtime: RuntimeClient,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeVideoModel {
  return {
    generate: async (options) => {
      try {
        const resolvedRoute = options.routePolicy || defaults.routePolicy;
        const resolvedFallback = options.fallback || defaults.fallback;
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          subjectUserId: defaults.subjectUserId,
          modelId,
          modal: MODAL_VIDEO,
          routePolicy: resolveRoutePolicy(resolvedRoute),
          fallback: resolveFallbackPolicy(resolvedFallback),
          timeoutMs,
          spec: {
            oneofKind: 'videoSpec',
            videoSpec: {
              prompt: normalizeText(options.prompt),
              negativePrompt: normalizeText(options.negativePrompt),
              durationSec: Number(options.durationSec || 0),
              fps: Number(options.fps || 0),
              resolution: normalizeText(options.resolution),
              aspectRatio: normalizeText(options.aspectRatio),
              seed: Number(options.seed || 0),
              providerOptions: toProtoStruct(options.providerOptions),
            },
          },
        }, timeoutMs, options.signal);
        return {
          artifacts: media.artifacts,
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

function createSpeechModel(
  runtime: RuntimeClient,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeSpeechModel {
  return {
    synthesize: async (options) => {
      try {
        const resolvedRoute = options.routePolicy || defaults.routePolicy;
        const resolvedFallback = options.fallback || defaults.fallback;
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          subjectUserId: defaults.subjectUserId,
          modelId,
          modal: MODAL_TTS,
          routePolicy: resolveRoutePolicy(resolvedRoute),
          fallback: resolveFallbackPolicy(resolvedFallback),
          timeoutMs,
          spec: {
            oneofKind: 'speechSpec',
            speechSpec: {
              text: normalizeText(options.text),
              voice: normalizeText(options.voice),
              language: normalizeText(options.language),
              audioFormat: normalizeText(options.audioFormat),
              sampleRateHz: Number(options.sampleRateHz || 0),
              speed: Number(options.speed || 0),
              pitch: Number(options.pitch || 0),
              volume: Number(options.volume || 0),
              providerOptions: toProtoStruct(options.providerOptions),
            },
          },
        }, timeoutMs, options.signal);
        return {
          artifacts: media.artifacts,
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

function createTranscriptionModel(
  runtime: RuntimeClient,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeTranscriptionModel {
  return {
    transcribe: async (options) => {
      try {
        if (!(options.audioBytes && options.audioBytes.length > 0) && !normalizeText(options.audioUrl)) {
          throw createNimiError({
            message: 'audioBytes or audioUrl is required',
            reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
            actionHint: 'set_audio_bytes_or_audio_url',
            source: 'sdk',
          });
        }
        const resolvedRoute = options.routePolicy || defaults.routePolicy;
        const resolvedFallback = options.fallback || defaults.fallback;
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          subjectUserId: defaults.subjectUserId,
          modelId,
          modal: MODAL_STT,
          routePolicy: resolveRoutePolicy(resolvedRoute),
          fallback: resolveFallbackPolicy(resolvedFallback),
          timeoutMs,
          spec: {
            oneofKind: 'transcriptionSpec',
            transcriptionSpec: {
              audioBytes: options.audioBytes || new Uint8Array(0),
              audioUri: normalizeText(options.audioUrl),
              mimeType: normalizeText(options.mimeType || 'audio/wav'),
              language: normalizeText(options.language),
              timestamps: Boolean(options.timestamps),
              diarization: Boolean(options.diarization),
              speakerCount: Number(options.speakerCount || 0),
              prompt: normalizeText(options.prompt),
              providerOptions: toProtoStruct(options.providerOptions),
            },
          },
        }, timeoutMs, undefined);
        const firstArtifact = media.artifacts[0];
        const text = firstArtifact ? normalizeText(toUtf8(firstArtifact.bytes)) : '';
        return {
          text,
          traceId: normalizeText(media.traceId),
          routeDecision: media.routeDecision,
          modelResolved: normalizeText(media.modelResolved),
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

export function createNimiAiProvider(config: NimiAiProviderConfig): NimiAiProvider {
  const { runtime, defaults } = ensureRuntime(config);

  const provider = ((modelId: string): LanguageModelV3 => createLanguageModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  )) as NimiAiProvider;

  provider.text = (modelId: string): LanguageModelV3 => createLanguageModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.embedding = (modelId: string): EmbeddingModelV3 => createEmbeddingModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.image = (modelId: string): ImageModelV3 => createImageModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.video = (modelId: string): NimiRuntimeVideoModel => createVideoModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.tts = (modelId: string): NimiRuntimeSpeechModel => createSpeechModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.stt = (modelId: string): NimiRuntimeTranscriptionModel => createTranscriptionModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );

  return provider;
}
