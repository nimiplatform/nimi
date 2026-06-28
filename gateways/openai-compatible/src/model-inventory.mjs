import { OpenAICompatibleGatewayError } from './errors.mjs';
import {
  isRecord,
  normalizeCapabilityList,
  normalizeText,
} from './gateway-utils.mjs';

export const IMAGE_GENERATE_CAPABILITY = 'image.generate';
export const TEXT_GENERATE_CAPABILITY = 'text.generate';
export const TEXT_STREAM_CAPABILITY = 'text.stream';
export const TEXT_EMBED_CAPABILITY = 'text.embed';
export const AUDIO_SYNTHESIZE_CAPABILITY = 'audio.synthesize';

const OPENAI_MODEL_CAPABILITIES = new Set([
  IMAGE_GENERATE_CAPABILITY,
  'image.edit',
  TEXT_GENERATE_CAPABILITY,
  TEXT_STREAM_CAPABILITY,
  TEXT_EMBED_CAPABILITY,
  AUDIO_SYNTHESIZE_CAPABILITY,
]);

export async function listSupportedImageGenerationModels(config) {
  const models = await listSupportedOpenAIModels(config);
  return models.filter((model) => model.capabilities.includes(IMAGE_GENERATE_CAPABILITY));
}

export async function listSupportedOpenAIModels(config) {
  if (typeof config.runtime.listModels === 'function') {
    return normalizeRuntimeModelInventory(await config.runtime.listModels());
  }
  if (typeof config.runtime.listImageGenerationModels === 'function') {
    return normalizeRuntimeModelInventory(await config.runtime.listImageGenerationModels());
  }
  throw new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_MODEL_CATALOG_UNAVAILABLE',
    'OpenAI-compatible gateway requires Runtime model projection for /v1/models.',
    502,
  );
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
    if (!isRuntimeSupportedOpenAIModel(model)) {
      continue;
    }
    supported.push({
      id,
      runtimeModelId,
      targetRef,
      capabilities: normalizeCapabilityList(model.capabilities),
    });
  }
  return supported;
}

function isRuntimeSupportedOpenAIModel(model) {
  const productState = normalizeText(model.productState || model.product_state);
  const supported = model.supported === true || productState === 'supported';
  if (!supported) {
    return false;
  }
  if (!Array.isArray(model.capabilities)) {
    return false;
  }
  return normalizeCapabilityList(model.capabilities)
    .some((capability) => OPENAI_MODEL_CAPABILITIES.has(capability));
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
