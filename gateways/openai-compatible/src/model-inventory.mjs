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
    'OpenAI-compatible gateway requires a compatibility model catalog for /v1/models.',
    502,
  );
}

function normalizeRuntimeModelInventory(value) {
  if (!Array.isArray(value)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
      'Runtime compatibility model projection must return an array.',
      502,
    );
  }
  const seen = new Set();
  const supported = [];
  for (const [index, model] of value.entries()) {
    if (!isRecord(model)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        `Runtime compatibility model projection at index ${index} must be an object.`,
        502,
      );
    }
    const id = normalizeText(model.id);
    const capabilities = normalizeCapabilityList(model.capabilities);
    if (!id || capabilities.length === 0) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        'Runtime compatibility model projection entries require id and capabilities.',
        502,
      );
    }
    if (seen.has(id)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_MODEL_CATALOG_INVALID',
        `Runtime compatibility model projection contains duplicate id: ${id}`,
        502,
      );
    }
    seen.add(id);
    if (!isRuntimeSupportedOpenAIModel(model, capabilities)) {
      continue;
    }
    supported.push({ id, capabilities });
  }
  return supported;
}

function isRuntimeSupportedOpenAIModel(model, capabilities) {
  const productState = normalizeText(model.productState || model.product_state);
  const supported = model.supported === true || productState === 'supported';
  return supported && capabilities.some((capability) => OPENAI_MODEL_CAPABILITIES.has(capability));
}
