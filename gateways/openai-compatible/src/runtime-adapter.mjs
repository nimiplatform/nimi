import { OpenAICompatibleGatewayError } from './errors.mjs';

export function createOpenAICompatibleRuntimeAdapter(options) {
  const config = normalizeAdapterOptions(options);
  const adapter = {
    listImageGenerationModels: config.listImageGenerationModels,
    runImageGenerationJob(request) {
      return runImageGenerationJob(config, request);
    },
  };
  if (config.readArtifactBytes) {
    adapter.readArtifactBytes = (request) => readArtifactBytes(config, request);
  }
  return adapter;
}

function normalizeAdapterOptions(options) {
  if (!isRecord(options)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_ADAPTER_OPTIONS_REQUIRED',
      'OpenAI-compatible Runtime adapter options are required.',
    );
  }
  if (!options.runtime) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_CLIENT_REQUIRED',
      'OpenAI-compatible Runtime adapter requires a public Runtime client.',
    );
  }
  if (typeof options.runNimiRuntimeImageGeneration !== 'function') {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_IMAGE_HELPER_REQUIRED',
      'OpenAI-compatible Runtime adapter requires runNimiRuntimeImageGeneration from the public SDK.',
    );
  }
  if (typeof options.listImageGenerationModels !== 'function') {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_MODEL_SOURCE_REQUIRED',
      'OpenAI-compatible Runtime adapter requires an explicit compatibility model catalog.',
    );
  }

  return {
    runtime: options.runtime,
    runNimiRuntimeImageGeneration: options.runNimiRuntimeImageGeneration,
    listImageGenerationModels: () => options.listImageGenerationModels(),
    readArtifactBytes: resolveArtifactReader(options),
    timeoutMs: normalizeOptionalPositiveInteger(options.timeoutMs, 'timeoutMs'),
    callOptions: options.callOptions,
    extensions: Array.isArray(options.extensions) ? options.extensions : undefined,
    createdUnixSeconds: typeof options.createdUnixSeconds === 'function' ? options.createdUnixSeconds : undefined,
  };
}

function resolveArtifactReader(options) {
  if (typeof options.readArtifactBytes === 'function') {
    return (request, callOptions) => options.readArtifactBytes(request, callOptions);
  }
  if (isRecord(options.artifacts) && typeof options.artifacts.readArtifactBytes === 'function') {
    return (request, callOptions) => options.artifacts.readArtifactBytes(request, callOptions);
  }
  if (
    isRecord(options.runtime)
    && isRecord(options.runtime.artifacts)
    && typeof options.runtime.artifacts.readArtifactBytes === 'function'
  ) {
    return (request, callOptions) => options.runtime.artifacts.readArtifactBytes(request, callOptions);
  }
  return undefined;
}

async function runImageGenerationJob(config, request) {
  if (!isRecord(request) || !isRecord(request.scenario)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_REQUEST_INVALID',
      'OpenAI-compatible Runtime adapter received an invalid image generation request.',
      502,
    );
  }
  assertSdkImageScenarioPreservesFields(request.scenario);
  const sdkInput = omitUndefined({
    runtime: config.runtime,
    head: omitUndefined({
      appId: requiredText(request.appId, 'Runtime adapter image generation requires appId.'),
      subjectUserId: normalizeText(request.subjectUserId) || undefined,
      timeoutMs: config.timeoutMs,
    }),
    prompt: requiredText(request.scenario.prompt, 'Runtime adapter image generation requires prompt.'),
    negativePrompt: normalizeText(request.scenario.negativePrompt) || undefined,
    count: request.scenario.count,
    size: normalizeText(request.scenario.size) || undefined,
    aspectRatio: normalizeText(request.scenario.aspectRatio) || undefined,
    quality: normalizeText(request.scenario.quality) || undefined,
    style: normalizeText(request.scenario.style) || undefined,
    seed: request.scenario.seed,
    referenceImages: Array.isArray(request.scenario.referenceImages) ? request.scenario.referenceImages : undefined,
    mask: normalizeText(request.scenario.mask) || undefined,
    outputFormat: normalizeText(request.scenario.outputFormat) || undefined,
    outputCompression: request.scenario.outputCompression,
    background: normalizeText(request.scenario.background) || undefined,
    moderation: normalizeText(request.scenario.moderation) || undefined,
    partialImages: request.scenario.partialImages,
    user: normalizeText(request.scenario.user) || undefined,
    responseFormat: normalizeText(request.scenario.responseFormat) || undefined,
    requestId: requiredText(request.requestId, 'Runtime adapter image generation requires requestId.'),
    idempotencyKey: requiredText(request.idempotencyKey, 'Runtime adapter image generation requires idempotencyKey.'),
    labels: request.labels,
    extensions: config.extensions,
    callOptions: config.callOptions,
    signal: request.signal,
  });
  const result = await config.runNimiRuntimeImageGeneration(sdkInput);
  if (!isRecord(result) || !Array.isArray(result.artifacts)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_RESPONSE_INVALID',
      'SDK Runtime image generation helper returned no artifact list.',
      502,
    );
  }
  return omitUndefined({
    createdUnixSeconds: config.createdUnixSeconds?.(),
    artifacts: result.artifacts,
    job: result.job,
    traceId: result.traceId,
  });
}

function assertSdkImageScenarioPreservesFields(scenario) {
  const unsupported = [
    'outputFormat',
    'outputCompression',
    'background',
    'moderation',
    'partialImages',
    'user',
  ].filter((key) => scenario[key] !== undefined && scenario[key] !== null && scenario[key] !== '');
  if (unsupported.length > 0) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
      `Public SDK image generation helper cannot preserve OpenAI image fields yet: ${unsupported.join(', ')}.`,
    );
  }
}

function readArtifactBytes(config, request) {
  const artifactId = requiredText(request?.artifactId, 'Runtime adapter artifact reads require artifactId.');
  return config.readArtifactBytes({ artifactId }, config.callOptions);
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_ADAPTER_OPTIONS_INVALID',
      `OpenAI-compatible Runtime adapter ${label} must be a positive integer.`,
    );
  }
  return number;
}

function requiredText(value, message) {
  const text = normalizeText(value);
  if (!text) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_REQUEST_INVALID',
      message,
      502,
    );
  }
  return text;
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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
