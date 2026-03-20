import { normalizeText } from './utils.js';
import { createNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';

const LEGACY_LOCAL_MODEL_PREFIXES = new Set([
  'localai',
  'nexa',
  'nimi_media',
  'media.diffusers',
  'localsidecar',
]);

export function readLegacyLocalModelPrefix(modelId: string): string {
  const normalized = normalizeText(modelId);
  const prefix = normalized.includes('/') ? normalized.split('/', 1)[0] || '' : normalized;
  const lowered = prefix.toLowerCase();
  return LEGACY_LOCAL_MODEL_PREFIXES.has(lowered) ? prefix : '';
}

export function assertNoLegacyLocalModelPrefix(modelId: string): void {
  const prefix = readLegacyLocalModelPrefix(modelId);
  if (!prefix) {
    return;
  }
  throw createNimiError({
    message: `legacy local model prefix "${prefix}" is no longer supported. Use local/, llama/, media/, speech/, or sidecar/.`,
    reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
    actionHint: 'rename_legacy_local_model_prefix',
    source: 'sdk',
  });
}
