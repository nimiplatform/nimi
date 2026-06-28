import { randomUUID } from 'node:crypto';

export { OpenAICompatibleGatewayError } from './errors.mjs';
export { createOpenAICompatibleRuntimeAdapter } from './runtime-adapter.mjs';
export {
  assertLoopbackHost,
  createOpenAICompatibleGatewayHttpServer,
  listenOpenAICompatibleGateway,
} from './server.mjs';
import { OpenAICompatibleGatewayError } from './errors.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const OPENAI_PREFIX = '/openai/v1';
const SUPPORTED_IMAGE_GENERATION_KEYS = new Set([
  'model',
  'prompt',
  'n',
  'size',
  'response_format',
  'seed',
  'negative_prompt',
]);
const IMAGE_GENERATE_CAPABILITY = 'image.generate';
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
    const models = await listSupportedImageGenerationModels(this.#config);
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
  if (!isRecord(options)) {
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
  if (
    !isRecord(options.runtime)
    || typeof options.runtime.runImageGenerationJob !== 'function'
    || typeof options.runtime.listImageGenerationModels !== 'function'
  ) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_CLIENT_REQUIRED',
      'OpenAI-compatible gateway requires a Runtime image generation job client and model projection client.',
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

async function listSupportedImageGenerationModels(config) {
  const models = await config.runtime.listImageGenerationModels();
  return normalizeRuntimeModelInventory(models);
}

function normalizeRuntimeModelInventory(value) {
  if (!Array.isArray(value)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
      'Runtime image generation model projection must return an array.',
      502,
    );
  }
  const seen = new Set();
  const supported = [];
  for (const [index, model] of value.entries()) {
    if (!isRecord(model)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        `Runtime image generation model projection at index ${index} must be an object.`,
        502,
      );
    }
    const id = normalizeText(model.id);
    const targetRef = normalizeTargetRef(model.targetRef);
    const runtimeModelId = normalizeText(model.runtimeModelId) || targetRefKey(targetRef);
    if (!id || !runtimeModelId || !targetRef) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        'Runtime image generation model projection entries require id, runtimeModelId, and targetRef.',
        502,
      );
    }
    if (seen.has(id)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        `Runtime image generation model projection contains duplicate id: ${id}`,
        502,
      );
    }
    seen.add(id);
    if (!isRuntimeSupportedImageModel(model)) {
      continue;
    }
    supported.push({
      id,
      runtimeModelId,
      targetRef,
    });
  }
  return supported;
}

function isRuntimeSupportedImageModel(model) {
  const productState = normalizeText(model.productState || model.product_state);
  const supported = model.supported === true || productState === 'supported';
  if (!supported) {
    return false;
  }
  if (!Array.isArray(model.capabilities)) {
    return false;
  }
  return model.capabilities.map((capability) => normalizeText(capability)).includes(IMAGE_GENERATE_CAPABILITY);
}

function normalizeTargetRef(value) {
  const text = normalizeText(value);
  if (text) {
    return text;
  }
  if (isRouteTargetRef(value) || isRuntimeDurableTargetRef(value)) {
    return value;
  }
  return undefined;
}

function targetRefKey(targetRef) {
  if (typeof targetRef === 'string') {
    return targetRef;
  }
  if (!isRecord(targetRef)) {
    return '';
  }
  if (targetRef.kind === 'local-runtime') {
    return [
      'local-runtime',
      normalizeText(targetRef.version),
      normalizeText(targetRef.profileBindingId),
      normalizeText(targetRef.readinessRef),
    ].join('|');
  }
  if (targetRef.kind === 'cloud-connector') {
    return [
      'cloud-connector',
      normalizeText(targetRef.version),
      normalizeText(targetRef.connectorId),
      normalizeText(targetRef.remoteModelCatalogId),
      normalizeText(targetRef.providerModelId),
    ].join('|');
  }
  if (isRecord(targetRef.target)) {
    return [
      'durable',
      normalizeText(targetRef.target.oneofKind),
      JSON.stringify(targetRef.target),
    ].join('|');
  }
  return JSON.stringify(targetRef);
}

function isRouteTargetRef(value) {
  if (!isRecord(value)) return false;
  if (value.kind === 'local-runtime') {
    if (value.version !== 'v2') return false;
    const profileBindingId = normalizeText(value.profileBindingId);
    const readinessRef = normalizeText(value.readinessRef);
    return Boolean(profileBindingId) !== Boolean(readinessRef);
  }
  if (value.kind === 'cloud-connector') {
    return value.version === 'v2'
      && Boolean(normalizeText(value.connectorId))
      && Boolean(normalizeText(value.remoteModelCatalogId))
      && Boolean(normalizeText(value.providerModelId));
  }
  return false;
}

function isRuntimeDurableTargetRef(value) {
  if (!isRecord(value) || !isRecord(value.target)) return false;
  if (value.target.oneofKind === 'localRuntime') {
    const localRuntime = value.target.localRuntime;
    if (!isRecord(localRuntime) || localRuntime.version !== 'v2' || !isRecord(localRuntime.ref)) return false;
    const profileBindingId = normalizeText(localRuntime.ref.profileBindingId);
    const readinessRef = normalizeText(localRuntime.ref.readinessRef);
    return Boolean(profileBindingId) !== Boolean(readinessRef);
  }
  if (value.target.oneofKind === 'cloud') {
    const cloud = value.target.cloud;
    return isRecord(cloud)
      && cloud.version === 'v2'
      && Boolean(normalizeText(cloud.connectorId))
      && Boolean(normalizeText(cloud.remoteModelCatalogId))
      && Boolean(normalizeText(cloud.providerModelId));
  }
  return false;
}

async function normalizeImageGenerationRequest(body, config) {
  if (!isRecord(body)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'images.generations request body must be a JSON object.',
    );
  }
  validateAllowedKeys(body, SUPPORTED_IMAGE_GENERATION_KEYS, 'images.generations');
  const modelId = normalizeText(body.model);
  const model = await resolveImageGenerationModel(config, modelId);
  if (!model) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_MODEL_NOT_FOUND',
      `OpenAI-compatible model alias is not configured: ${modelId || '<empty>'}`,
      404,
    );
  }
  const prompt = normalizeText(body.prompt);
  if (!prompt) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_PROMPT_REQUIRED',
      'images.generations prompt is required.',
    );
  }
  const count = normalizePositiveInteger(body.n ?? 1, 'images.generations.n');
  if (count !== 1) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
      'images.generations.n greater than 1 is not supported by this gateway.',
    );
  }
  const responseFormat = normalizeResponseFormat(body.response_format);
  const scenario = {
    kind: 'image',
    prompt,
    count,
    size: normalizeOptionalImageSize(body.size),
    seed: normalizeOptionalSeed(body.seed),
    negativePrompt: normalizeOptionalText(body.negative_prompt),
    responseFormat,
  };
  return {
    model,
    responseFormat,
    scenario: omitUndefined(scenario),
  };
}

async function resolveImageGenerationModel(config, modelId) {
  const models = await listSupportedImageGenerationModels(config);
  return models.find((model) => model.id === modelId);
}

async function imageGenerationResponse(runtimeResult, responseFormat, config, artifactOrigin) {
  if (!isRecord(runtimeResult) || !Array.isArray(runtimeResult.artifacts)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_RESPONSE_INVALID',
      'Runtime image generation job returned no artifact list.',
      502,
    );
  }
  const created = typeof runtimeResult.createdUnixSeconds === 'number'
    ? runtimeResult.createdUnixSeconds
    : Math.floor(Date.now() / 1000);
  return {
    created,
    data: await Promise.all(
      runtimeResult.artifacts.map((artifact, index) => imageArtifactToOpenAIData(
        artifact,
        responseFormat,
        index,
        config,
        artifactOrigin,
      )),
    ),
  };
}

async function imageArtifactToOpenAIData(artifact, responseFormat, index, config, artifactOrigin) {
  if (!isRecord(artifact)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_RESPONSE_INVALID',
      `Runtime image artifact at index ${index} must be an object.`,
      502,
    );
  }
  if (responseFormat === 'url') {
    const resolved = await resolveArtifactBytes(artifact, config, index);
    const artifactId = config.artifactIdGenerator();
    config.artifacts.set(artifactId, {
      bytes: resolved.bytes,
      mimeType: resolved.mimeType,
      expiresAtMs: config.nowMs() + config.artifactTtlMs,
    });
    return {
      url: new URL(`${OPENAI_PREFIX}/artifacts/${encodeURIComponent(artifactId)}`, artifactOrigin)
        .toString(),
    };
  }
  const { bytes } = await resolveArtifactBytes(artifact, config, index);
  return { b64_json: Buffer.from(bytes).toString('base64') };
}

async function resolveArtifactBytes(artifact, config, index) {
  const bytes = artifact.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    const artifactId = normalizeText(artifact.artifactId || artifact.artifact_id || artifact.id);
    if (artifactId && typeof config.runtime.readArtifactBytes === 'function') {
      const resolved = await config.runtime.readArtifactBytes({ artifactId });
      if (isRecord(resolved) && resolved.bytes instanceof Uint8Array && resolved.bytes.length > 0) {
        return {
          bytes: resolved.bytes,
          mimeType: normalizeText(resolved.mimeType || resolved.mime_type || artifact.mimeType || artifact.mime_type)
            || 'application/octet-stream',
        };
      }
    }
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_IMAGE_BYTES_UNAVAILABLE',
      `Runtime image artifact at index ${index} did not include readable bytes.`,
      502,
    );
  }
  return {
    bytes,
    mimeType: normalizeText(artifact.mimeType || artifact.mime_type) || 'application/octet-stream',
  };
}

function assertLoopbackRemoteAddress(context) {
  const remoteAddress = normalizeText(context.remoteAddress);
  if (!isLoopbackRemoteAddress(remoteAddress)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_LOOPBACK_REQUIRED',
      'OpenAI-compatible gateway v1 requires verified loopback client evidence.',
      403,
    );
  }
}

function assertAuthorized(request, config, context) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  const token = match ? match[1].trim() : '';
  if (!token || !config.apiKeys.has(token)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_AUTH_REQUIRED',
      'OpenAI-compatible gateway requires a valid local API key.',
      401,
    );
  }
}

function isLoopbackRemoteAddress(remoteAddress) {
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
}

function resolveGatewayArtifactOrigin(config, requestUrl, context) {
  if (config.publicBaseUrl) {
    return config.publicBaseUrl;
  }
  const contextOrigin = normalizeOptionalText(context.gatewayOrigin || context.publicBaseUrl);
  if (contextOrigin) {
    return normalizePublicBaseUrl(contextOrigin);
  }
  return normalizePublicBaseUrl(originFromUrl(requestUrl));
}

function normalizePublicBaseUrl(value) {
  const text = normalizeOptionalText(value);
  if (!text) return undefined;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw invalidPublicBaseUrl();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalidPublicBaseUrl();
  }
  if (!isLoopbackOriginHostname(url.hostname)) {
    throw invalidPublicBaseUrl();
  }
  return url.origin;
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    throw invalidPublicBaseUrl();
  }
}

function invalidPublicBaseUrl() {
  return new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_PUBLIC_BASE_URL_INVALID',
    'OpenAI-compatible gateway v1 artifact URLs require a numeric loopback origin.',
  );
}

function isLoopbackOriginHostname(value) {
  const hostname = normalizeText(value).replace(/^\[|\]$/gu, '');
  return hostname === '127.0.0.1' || hostname === '::1';
}

function assertMethod(request, expected) {
  if (request.method.toUpperCase() !== expected) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_METHOD_NOT_ALLOWED',
      `Expected ${expected} for this OpenAI-compatible gateway route.`,
      405,
    );
  }
}

async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_CONTENT_TYPE_INVALID',
      'OpenAI-compatible gateway requests must use application/json.',
    );
  }
  try {
    return await request.json();
  } catch {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_JSON_INVALID',
      'OpenAI-compatible gateway request body must be valid JSON.',
    );
  }
}

function normalizeOpenAIPath(pathname) {
  if (pathname === '/healthz') return pathname;
  if (pathname === OPENAI_PREFIX) return '/';
  if (pathname.startsWith(`${OPENAI_PREFIX}/`)) {
    return pathname.slice(OPENAI_PREFIX.length);
  }
  return pathname;
}

function validateAllowedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
        `${path}.${key} is not supported by this gateway.`,
      );
    }
  }
}

function normalizeResponseFormat(value) {
  const text = normalizeText(value);
  if (!text) return 'url';
  if (text === 'url' || text === 'b64_json') return text;
  throw new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
    `images.generations.response_format ${text} is not supported by this gateway.`,
  );
}

function normalizeOptionalImageSize(value) {
  const text = normalizeOptionalText(value);
  if (!text) return undefined;
  if (!/^[1-9]\d{1,4}x[1-9]\d{1,4}$/u.test(text)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'images.generations.size must use WIDTHxHEIGHT format.',
    );
  }
  return text;
}

function normalizePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} must be a positive integer.`,
    );
  }
  return number;
}

function normalizeOptionalSeed(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'images.generations.seed must be a safe integer.',
    );
  }
  return number;
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || undefined;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function omitUndefined(value) {
  const out = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== undefined) {
      out[key] = nestedValue;
    }
  }
  return out;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(error) {
  if (error instanceof OpenAICompatibleGatewayError) {
    return jsonResponse(error.status, {
      error: {
        message: error.message,
        type: error.type,
        code: error.code,
      },
    });
  }
  return jsonResponse(500, {
    error: {
      message: 'OpenAI-compatible gateway request failed.',
      type: 'server_error',
      code: 'NIMI_GATEWAY_INTERNAL_ERROR',
    },
  });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
