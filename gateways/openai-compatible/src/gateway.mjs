import { randomUUID } from 'node:crypto';

import { OpenAICompatibleGatewayError } from './errors.mjs';
import { listSupportedOpenAIModels } from './model-inventory.mjs';
import {
  normalizeChatCompletionRequest,
  normalizeEmbeddingRequest,
  normalizeImageGenerationRequest,
  normalizeResponseRequest,
  normalizeSpeechRequest,
} from './openai-normalizers.mjs';
import {
  chatCompletionResponse,
  chatCompletionStreamResponse,
  embeddingResponse,
  imageGenerationResponse,
  resolveAudioBytes,
  responseApiResponse,
} from './openai-responses.mjs';
import {
  assertAuthorized,
  assertLoopbackRemoteAddress,
  assertMethod,
  callRequiredRuntimeMethod,
  errorResponse,
  jsonResponse,
  normalizeOpenAIPath,
  normalizePositiveInteger,
  normalizePublicBaseUrl,
  normalizeText,
  readJsonBody,
  resolveGatewayArtifactOrigin,
  unsupportedFeature,
} from './gateway-utils.mjs';

const DEFAULT_ARTIFACT_TTL_MS = 10 * 60 * 1000;

export function createOpenAICompatibleGateway(options) {
  const config = normalizeGatewayOptions(options);
  return new OpenAICompatibleGateway(config);
}

class OpenAICompatibleGateway {
  #config;

  constructor(config) {
    this.#config = config;
  }

  async fetch(request, context = {}) {
    try {
      const url = new URL(request.url);
      const path = normalizeOpenAIPath(url.pathname);
      assertLoopbackRemoteAddress(context);
      if (path === '/healthz') {
        return jsonResponse(200, { status: 'ok' });
      }

      assertAuthorized(request, this.#config, context);

      if (path === '/models') {
        assertMethod(request, 'GET');
        return jsonResponse(200, await this.#modelsResponse());
      }

      if (path.startsWith('/artifacts/')) {
        assertMethod(request, 'GET');
        return this.#artifactResponse(path);
      }

      if (path === '/images/generations') {
        assertMethod(request, 'POST');
        return jsonResponse(200, await this.#createImageGeneration(request, context));
      }

      if (path === '/images/edits') {
        assertMethod(request, 'POST');
        return await this.#createImageEdit();
      }

      if (path === '/images/variations') {
        assertMethod(request, 'POST');
        return await this.#createImageVariation();
      }

      if (path === '/chat/completions') {
        assertMethod(request, 'POST');
        return await this.#createChatCompletion(request);
      }

      if (path === '/responses') {
        assertMethod(request, 'POST');
        return await this.#createResponse(request);
      }

      if (path === '/embeddings') {
        assertMethod(request, 'POST');
        return jsonResponse(200, await this.#createEmbedding(request));
      }

      if (path === '/audio/speech') {
        assertMethod(request, 'POST');
        return await this.#createSpeech(request);
      }

      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_ROUTE_NOT_FOUND',
        `OpenAI-compatible gateway route is not supported: ${url.pathname}`,
        404,
      );
    } catch (error) {
      return errorResponse(error);
    }
  }

  async #modelsResponse() {
    const created = this.#config.createdUnixSeconds();
    const models = await listSupportedOpenAIModels(this.#config);
    return {
      object: 'list',
      data: models.map((model) => ({
        id: model.id,
        object: 'model',
        created,
        owned_by: 'nimi-runtime',
      })),
    };
  }

  async #createChatCompletion(request) {
    const body = await readJsonBody(request);
    const normalized = await normalizeChatCompletionRequest(body, this.#config);
    if (normalized.stream) {
      return chatCompletionStreamResponse(this.#config, normalized);
    }
    const runtimeResult = await callRequiredRuntimeMethod(
      this.#config.runtime,
      'runChatCompletion',
      'chat.completions.create',
      normalized.runtimeRequest,
    );
    return jsonResponse(200, chatCompletionResponse(runtimeResult, normalized));
  }

  async #createResponse(request) {
    const body = await readJsonBody(request);
    const normalized = await normalizeResponseRequest(body, this.#config);
    if (normalized.stream) {
      throw unsupportedFeature('responses.stream', 'Runtime response streaming is not wired for this gateway.');
    }
    const runtimeResult = await callRequiredRuntimeMethod(
      this.#config.runtime,
      'runResponse',
      'responses.create',
      normalized.runtimeRequest,
    );
    return jsonResponse(200, responseApiResponse(runtimeResult, normalized));
  }

  async #createEmbedding(request) {
    const body = await readJsonBody(request);
    const normalized = await normalizeEmbeddingRequest(body, this.#config);
    const runtimeResult = await callRequiredRuntimeMethod(
      this.#config.runtime,
      'runEmbedding',
      'embeddings.create',
      normalized.runtimeRequest,
    );
    return embeddingResponse(runtimeResult, normalized);
  }

  async #createSpeech(request) {
    const body = await readJsonBody(request);
    const normalized = await normalizeSpeechRequest(body, this.#config);
    const runtimeResult = await callRequiredRuntimeMethod(
      this.#config.runtime,
      'runSpeechSynthesis',
      'audio.speech.create',
      normalized.runtimeRequest,
    );
    const audio = await resolveAudioBytes(runtimeResult, this.#config);
    return new Response(audio.bytes, {
      status: 200,
      headers: {
        'content-type': audio.mimeType,
        'cache-control': 'no-store',
      },
    });
  }

  async #createImageGeneration(request, context) {
    const body = await readJsonBody(request);
    const normalized = await normalizeImageGenerationRequest(body, this.#config);
    const artifactOrigin = normalized.responseFormat === 'url'
      ? resolveGatewayArtifactOrigin(this.#config, request.url, context)
      : undefined;
    const requestId = this.#config.idGenerator();
    const runtimeResult = await this.#config.runtime.runImageGenerationJob({
      appId: this.#config.appId,
      subjectUserId: this.#config.subjectUserId,
      requestId,
      idempotencyKey: `openai-compatible:${requestId}`,
      model: {
        id: normalized.model.id,
        runtimeModelId: normalized.model.runtimeModelId,
        targetRef: normalized.model.targetRef,
      },
      scenario: normalized.scenario,
      labels: {
        gateway: 'openai-compatible',
        openaiEndpoint: 'images.generations',
        openaiModel: normalized.model.id,
      },
    });
    return imageGenerationResponse(
      runtimeResult,
      normalized.responseFormat,
      this.#config,
      artifactOrigin,
    );
  }

  async #createImageEdit() {
    if (typeof this.#config.runtime.runImageEditJob !== 'function') {
      throw unsupportedFeature('images.edits', 'Runtime image edit is not wired for this gateway.');
    }
    throw unsupportedFeature('images.edits', 'OpenAI image edit multipart parsing is not wired for this gateway.');
  }

  async #createImageVariation() {
    if (typeof this.#config.runtime.runImageVariationJob !== 'function') {
      throw unsupportedFeature('images.variations', 'Runtime image variation is not wired for this gateway.');
    }
    throw unsupportedFeature('images.variations', 'OpenAI image variation multipart parsing is not wired for this gateway.');
  }

  #artifactResponse(path) {
    const artifactId = decodeURIComponent(path.slice('/artifacts/'.length));
    const entry = this.#config.artifacts.get(artifactId);
    if (!entry || entry.expiresAtMs <= this.#config.nowMs()) {
      this.#config.artifacts.delete(artifactId);
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_ARTIFACT_NOT_FOUND',
        'OpenAI-compatible gateway artifact was not found or has expired.',
        404,
      );
    }
    return new Response(entry.bytes, {
      status: 200,
      headers: {
        'content-type': entry.mimeType,
        'cache-control': 'no-store',
      },
    });
  }
}

function normalizeGatewayOptions(options) {
  if (!isRecordLike(options)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_OPTIONS_REQUIRED',
      'OpenAI-compatible gateway options are required.',
    );
  }
  const appId = normalizeText(options.appId);
  if (!appId) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_APP_ID_REQUIRED',
      'OpenAI-compatible gateway requires an explicit Runtime app identity.',
    );
  }
  if (!isRecordLike(options.runtime)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_CLIENT_REQUIRED',
      'OpenAI-compatible gateway requires a Runtime capability client object.',
    );
  }

  const apiKeys = Array.isArray(options.apiKeys)
    ? options.apiKeys.map((key) => normalizeText(key)).filter(Boolean)
    : [];
  if (apiKeys.length === 0) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_API_KEY_REQUIRED',
      'OpenAI-compatible gateway requires at least one local API key.',
    );
  }

  return {
    appId,
    subjectUserId: normalizeText(options.subjectUserId) || 'local-user',
    runtime: options.runtime,
    apiKeys: new Set(apiKeys),
    artifacts: new Map(),
    artifactTtlMs: normalizePositiveInteger(options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS, 'artifactTtlMs'),
    publicBaseUrl: normalizePublicBaseUrl(options.publicBaseUrl),
    idGenerator: typeof options.idGenerator === 'function' ? options.idGenerator : () => `imgjob-${randomUUID()}`,
    artifactIdGenerator: typeof options.artifactIdGenerator === 'function'
      ? options.artifactIdGenerator
      : () => `artifact-${randomUUID()}`,
    createdUnixSeconds: typeof options.createdUnixSeconds === 'function'
      ? options.createdUnixSeconds
      : () => Math.floor(Date.now() / 1000),
    nowMs: typeof options.nowMs === 'function' ? options.nowMs : () => Date.now(),
  };
}

function isRecordLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
