import { OpenAICompatibleGatewayError } from './errors.mjs';

const IMAGE_GENERATE_CAPABILITY = 'image.generate';
const SUPPORTED_TARGET_STATUSES = new Set(['active', 'installed', 'ready']);

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

  const listImageGenerationModels = createModelLister(options);
  const artifactReader = resolveArtifactReader(options);
  return {
    runtime: options.runtime,
    runNimiRuntimeImageGeneration: options.runNimiRuntimeImageGeneration,
    listImageGenerationModels,
    toRuntimeDurableTargetRef: typeof options.toRuntimeDurableTargetRef === 'function'
      ? options.toRuntimeDurableTargetRef
      : undefined,
    readArtifactBytes: artifactReader,
    routePolicy: normalizeText(options.routePolicy) || 'local',
    timeoutMs: normalizeOptionalPositiveInteger(options.timeoutMs, 'timeoutMs'),
    callOptions: options.callOptions,
    extensions: Array.isArray(options.extensions) ? options.extensions : undefined,
    createdUnixSeconds: typeof options.createdUnixSeconds === 'function' ? options.createdUnixSeconds : undefined,
  };
}

function createModelLister(options) {
  if (typeof options.listImageGenerationModels === 'function') {
    return () => options.listImageGenerationModels();
  }
  if (typeof options.listNimiRuntimeRouteOptions !== 'function' || !options.routeOptionsClient) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_MODEL_SOURCE_REQUIRED',
      'OpenAI-compatible Runtime adapter requires listImageGenerationModels or SDK route-options projection.',
    );
  }
  const routeOptionsTargetId = normalizeText(options.routeOptionsTargetId);
  const modelIdForTarget = typeof options.modelIdForTarget === 'function'
    ? options.modelIdForTarget
    : defaultModelIdForTarget;
  return async () => {
    const input = { capability: IMAGE_GENERATE_CAPABILITY };
    if (routeOptionsTargetId) {
      input.targetId = routeOptionsTargetId;
    }
    const snapshot = await options.listNimiRuntimeRouteOptions(options.routeOptionsClient, input);
    return projectImageGenerationModelsFromRouteOptions(snapshot, modelIdForTarget);
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

function projectImageGenerationModelsFromRouteOptions(snapshot, modelIdForTarget) {
  if (!isRecord(snapshot) || !isRecord(snapshot.inventory) || !Array.isArray(snapshot.inventory.targets)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
      'SDK route-options image generation snapshot must include inventory.targets.',
      502,
    );
  }
  const seen = new Set();
  const models = [];
  for (const target of snapshot.inventory.targets) {
    if (!isRecord(target)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        'SDK route-options target entries must be objects.',
        502,
      );
    }
    const capabilities = normalizeCapabilityList(target.compatibility?.capabilities);
    if (!capabilities.includes(IMAGE_GENERATE_CAPABILITY)) {
      continue;
    }
    const targetRef = target.targetRef;
    if (!isRouteTargetRef(targetRef)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        'SDK route-options image generation targets require targetRef.',
        502,
      );
    }
    const id = normalizeText(modelIdForTarget(target));
    const runtimeModelId = runtimeModelIdForTarget(target);
    if (!id || !runtimeModelId) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        'SDK route-options image generation targets require public model id and runtime model id.',
        502,
      );
    }
    if (seen.has(id)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        `SDK route-options image generation model ids must be unique: ${id}`,
        502,
      );
    }
    seen.add(id);
    const supported = SUPPORTED_TARGET_STATUSES.has(normalizeText(target.readiness?.status).toLowerCase());
    models.push({
      id,
      runtimeModelId,
      targetRef,
      supported,
      productState: supported ? 'supported' : 'unsupported',
      capabilities,
    });
  }
  return models;
}

async function runImageGenerationJob(config, request) {
  if (!isRecord(request) || !isRecord(request.model) || !isRecord(request.scenario)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_REQUEST_INVALID',
      'OpenAI-compatible Runtime adapter received an invalid image generation request.',
      502,
    );
  }
  assertSdkImageScenarioPreservesFields(request.scenario);
  const targetRef = toScenarioTargetRef(config, request.model.targetRef);
  const sdkInput = omitUndefined({
    runtime: config.runtime,
    head: omitUndefined({
      appId: requiredText(request.appId, 'Runtime adapter image generation requires appId.'),
      subjectUserId: normalizeText(request.subjectUserId) || undefined,
      modelId: normalizeText(request.model.runtimeModelId) || normalizeText(request.model.id) || undefined,
      routePolicy: config.routePolicy,
      targetRef,
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

function toScenarioTargetRef(config, targetRef) {
  if (isRuntimeDurableTargetRef(targetRef)) {
    return targetRef;
  }
  if (typeof config.toRuntimeDurableTargetRef === 'function') {
    return config.toRuntimeDurableTargetRef(targetRef);
  }
  throw new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_RUNTIME_TARGET_REF_REQUIRED',
    'OpenAI-compatible Runtime adapter requires a Runtime durable targetRef or public SDK targetRef converter.',
    502,
  );
}

function readArtifactBytes(config, request) {
  const artifactId = requiredText(request?.artifactId, 'Runtime adapter artifact reads require artifactId.');
  return config.readArtifactBytes({ artifactId }, config.callOptions);
}

function isRuntimeDurableTargetRef(value) {
  return isRecord(value)
    && isRecord(value.target)
    && (value.target.oneofKind === 'localRuntime' || value.target.oneofKind === 'cloud');
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

function runtimeModelIdForTarget(target) {
  return normalizeText(target.display?.model)
    || normalizeText(target.display?.modelLabel)
    || normalizeText(target.evidence?.resolvedModelId)
    || normalizeText(target.evidence?.providerModelId)
    || normalizeText(target.evidence?.localAssetId)
    || targetRefKey(target.targetRef);
}

function defaultModelIdForTarget(target) {
  const evidence = target.evidence;
  const model = slugIdPart(runtimeModelIdForTarget(target));
  if (isRecord(evidence) && evidence.source === 'local-runtime') {
    return `local/${model}`;
  }
  if (isRecord(evidence) && evidence.source === 'cloud-connector') {
    const provider = slugIdPart(evidence.provider || evidence.connectorId || 'connector');
    return `cloud/${provider}/${model}`;
  }
  return `runtime/${model || slugIdPart(targetRefKey(target.targetRef))}`;
}

function targetRefKey(targetRef) {
  if (!isRecord(targetRef)) return '';
  if (targetRef.kind === 'local-runtime') {
    return [
      'local-runtime',
      targetRef.version,
      normalizeText(targetRef.profileBindingId),
      normalizeText(targetRef.readinessRef),
    ].join('|');
  }
  if (targetRef.kind === 'cloud-connector') {
    return [
      'cloud-connector',
      targetRef.version,
      normalizeText(targetRef.connectorId),
      normalizeText(targetRef.remoteModelCatalogId),
      normalizeText(targetRef.providerModelId),
    ].join('|');
  }
  return JSON.stringify(targetRef);
}

function normalizeCapabilityList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeText(item).toLowerCase()).filter(Boolean))];
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

function slugIdPart(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    || 'target';
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
