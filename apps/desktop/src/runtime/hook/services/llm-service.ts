import {
  invokeModEmbedding,
  invokeModImage,
  invokeModLlm,
  invokeModLlmStream,
  invokeModTranscribe,
  invokeModVideo,
} from '../../llm-adapter/execution';
import type { LocalAiProviderHints } from '../../local-ai-runtime/index.js';
import type { HookSourceType } from '../contracts/types.js';
import { createHookRecord, type PermissionResolver } from './utils.js';
import { HookAuditTrail } from '../audit/hook-audit.js';

export interface LlmServiceInput {
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
}

export interface LlmTextInput {
  modId: string;
  sourceType?: HookSourceType;
  provider: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  mode?: 'STORY' | 'SCENE_TURN';
  worldId?: string;
  agentId?: string;
  abortSignal?: AbortSignal;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
}

export interface LlmImageInput {
  modId: string;
  sourceType?: HookSourceType;
  provider: string;
  prompt: string;
  model?: string;
  negativePrompt?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  seed?: number;
  n?: number;
  referenceImages?: string[];
  mask?: string;
  responseFormat?: 'url' | 'base64';
  providerOptions?: Record<string, unknown>;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  providerHints?: LocalAiProviderHints;
}

export interface LlmVideoInput {
  modId: string;
  sourceType?: HookSourceType;
  provider: string;
  prompt: string;
  model?: string;
  negativePrompt?: string;
  durationSeconds?: number;
  fps?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  firstFrameUri?: string;
  lastFrameUri?: string;
  cameraMotion?: string;
  providerOptions?: Record<string, unknown>;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  providerHints?: LocalAiProviderHints;
}

export interface LlmEmbeddingInput {
  modId: string;
  sourceType?: HookSourceType;
  provider: string;
  input: string | string[];
  model?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
}

export interface LlmSpeechTranscribeInput {
  modId: string;
  sourceType?: HookSourceType;
  provider: string;
  audioUri?: string;
  audioBase64?: string;
  mimeType?: string;
  language?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
}

function createFallbackTraceId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function appendAllowAudit(
  audit: HookAuditTrail,
  input: {
    modId: string;
    target: string;
    reasonCodes: string[];
    startedAt: number;
  },
): void {
  audit.append(createHookRecord({
    modId: input.modId,
    hookType: 'llm',
    target: input.target,
    decision: 'ALLOW',
    reasonCodes: input.reasonCodes,
    startedAt: input.startedAt,
  }));
}

function tryDecodeDataText(base64Value: string | undefined): string | null {
  const raw = String(base64Value || '').trim();
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.split(',').slice(-1)[0] || '' : raw;
  if (!normalized) return null;

  if (typeof globalThis.atob === 'function') {
    try {
      return decodeURIComponent(escape(globalThis.atob(normalized))).trim() || null;
    } catch {
      // fallback below
    }
  }

  if (typeof Buffer !== 'undefined') {
    try {
      const decoded = Buffer.from(normalized, 'base64').toString('utf-8').trim();
      return decoded || null;
    } catch {
      return null;
    }
  }

  return null;
}

export class HookRuntimeLlmService {
  constructor(private readonly context: LlmServiceInput) {}

  async generateModText(input: LlmTextInput): Promise<{
    text: string;
    promptTraceId: string;
    traceId: string;
  }> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.text.generate',
      capabilityKey: 'llm.text.generate',
      startedAt,
    });

    const result = await invokeModLlm({
      modId: input.modId,
      provider: input.provider,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      mode: input.mode,
      worldId: input.worldId,
      agentId: input.agentId,
      abortSignal: input.abortSignal,
      localProviderEndpoint: input.localProviderEndpoint,
      localProviderModel: input.localProviderModel,
      localOpenAiEndpoint: input.localOpenAiEndpoint,
      connectorId: input.connectorId,
    });

    appendAllowAudit(this.context.audit, {
      modId: input.modId,
      target: 'llm.text.generate',
      reasonCodes: permission.reasonCodes,
      startedAt,
    });

    return result;
  }

  async *streamModText(
    input: LlmTextInput,
  ): AsyncIterable<{
    type: 'text_delta';
    textDelta: string;
  } | {
    type: 'done';
  }> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.text.stream',
      capabilityKey: 'llm.text.stream',
      startedAt,
    });

    appendAllowAudit(this.context.audit, {
      modId: input.modId,
      target: 'llm.text.stream',
      reasonCodes: permission.reasonCodes,
      startedAt,
    });

    for await (const event of invokeModLlmStream({
      modId: input.modId,
      provider: input.provider,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      mode: input.mode,
      worldId: input.worldId,
      agentId: input.agentId,
      abortSignal: input.abortSignal,
      localProviderEndpoint: input.localProviderEndpoint,
      localProviderModel: input.localProviderModel,
      localOpenAiEndpoint: input.localOpenAiEndpoint,
      connectorId: input.connectorId,

    })) {
      yield event;
    }
  }

  async generateModImage(input: LlmImageInput): Promise<{ images: Array<{ uri?: string; b64Json?: string; mimeType?: string }>; traceId: string }> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.image.generate',
      capabilityKey: 'llm.image.generate',
      startedAt,
    });

    const result = await invokeModImage({
      modId: input.modId,
      provider: input.provider,
      prompt: input.prompt,
      model: input.model || input.localProviderModel,
      negativePrompt: input.negativePrompt,
      size: input.size,
      aspectRatio: input.aspectRatio,
      quality: input.quality,
      style: input.style,
      seed: input.seed,
      n: input.n,
      referenceImages: input.referenceImages,
      mask: input.mask,
      responseFormat: input.responseFormat,
      providerOptions: input.providerOptions,
      abortSignal: undefined,
      localProviderEndpoint: input.localProviderEndpoint,
      localProviderModel: input.model || input.localProviderModel,
      localOpenAiEndpoint: input.localOpenAiEndpoint,
      connectorId: input.connectorId,
    });

    appendAllowAudit(this.context.audit, {
      modId: input.modId,
      target: 'llm.image.generate',
      reasonCodes: permission.reasonCodes,
      startedAt,
    });

    return result;
  }

  async generateModVideo(input: LlmVideoInput): Promise<{ videos: Array<{ uri?: string; mimeType?: string }>; traceId: string }> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.video.generate',
      capabilityKey: 'llm.video.generate',
      startedAt,
    });

    const result = await invokeModVideo({
      modId: input.modId,
      provider: input.provider,
      prompt: input.prompt,
      model: input.model || input.localProviderModel,
      negativePrompt: input.negativePrompt,
      durationSeconds: input.durationSeconds,
      fps: input.fps,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      seed: input.seed,
      firstFrameUri: input.firstFrameUri,
      lastFrameUri: input.lastFrameUri,
      cameraMotion: input.cameraMotion,
      providerOptions: input.providerOptions,
      abortSignal: undefined,
      localProviderEndpoint: input.localProviderEndpoint,
      localProviderModel: input.model || input.localProviderModel,
      localOpenAiEndpoint: input.localOpenAiEndpoint,
      connectorId: input.connectorId,
    });

    appendAllowAudit(this.context.audit, {
      modId: input.modId,
      target: 'llm.video.generate',
      reasonCodes: permission.reasonCodes,
      startedAt,
    });

    return result;
  }

  async generateModEmbedding(input: LlmEmbeddingInput): Promise<{ embeddings: number[][]; traceId: string }> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.embedding.generate',
      capabilityKey: 'llm.embedding.generate',
      startedAt,
    });

    appendAllowAudit(this.context.audit, {
      modId: input.modId,
      target: 'llm.embedding.generate',
      reasonCodes: permission.reasonCodes,
      startedAt,
    });

    return invokeModEmbedding({
      modId: input.modId,
      provider: input.provider,
      input: input.input,
      model: input.model,
      localProviderEndpoint: input.localProviderEndpoint,
      localProviderModel: input.model || input.localProviderModel,
      localOpenAiEndpoint: input.localOpenAiEndpoint,
      connectorId: input.connectorId,
    });
  }

  async transcribeModSpeech(input: LlmSpeechTranscribeInput): Promise<{ text: string; traceId: string }> {
    const startedAt = Date.now();
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'llm',
      target: 'llm.speech.transcribe',
      capabilityKey: 'llm.speech.transcribe',
      startedAt,
    });

    appendAllowAudit(this.context.audit, {
      modId: input.modId,
      target: 'llm.speech.transcribe',
      reasonCodes: permission.reasonCodes,
      startedAt,
    });

    const mimeType = String(input.mimeType || '').trim().toLowerCase();
    const isPlainTextPayload = mimeType.startsWith('text/');
    if (isPlainTextPayload) {
      const decodedText = tryDecodeDataText(input.audioBase64);
      if (decodedText) {
        return { text: decodedText, traceId: createFallbackTraceId('stt-inline') };
      }
    }

    if (input.audioUri && input.audioUri.startsWith('data:text/plain;base64,')) {
      const maybeDecoded = tryDecodeDataText(input.audioUri);
      if (maybeDecoded) return { text: maybeDecoded, traceId: createFallbackTraceId('stt-inline') };
    }

    return invokeModTranscribe({
      modId: input.modId,
      provider: input.provider,
      model: input.localProviderModel,
      audioUri: input.audioUri,
      audioBase64: input.audioBase64,
      mimeType: input.mimeType,
      language: input.language,
      localProviderEndpoint: input.localProviderEndpoint,
      localProviderModel: input.localProviderModel,
      localOpenAiEndpoint: input.localOpenAiEndpoint,
      connectorId: input.connectorId,
    });
  }
}
