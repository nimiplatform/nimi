import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useAppStore } from '../../app-shell/app-store.js';
import type { ParentosCapabilityId } from './parentos-ai-config.js';
import {
  getParentosAISurfacePolicy,
  type ParentosAISurfaceId,
} from './parentos-ai-surface-policy.js';
import { loadParentosRuntimeRouteOptions } from '../../infra/parentos-runtime-route-options.js';

export type ParentosCallParams = {
  model: string;
  route?: 'local' | 'cloud';
  connectorId?: string;
};

/**
 * Resolve AI call parameters from the user's AIConfig binding for a capability.
 *
 * If the user has configured a binding in AI settings, returns the model/route/connectorId
 * from that binding. Otherwise returns `{ model: 'auto' }` to use runtime defaults.
 *
 * Call sites spread the result into SDK calls:
 * ```ts
 * const params = resolveParentosBinding('text.generate');
 * await client.runtime.ai.text.generate({ ...params, input, temperature, ... });
 * ```
 */
export function resolveParentosBinding(capabilityId: ParentosCapabilityId): ParentosCallParams {
  const config = useAppStore.getState().aiConfig;
  if (!config) return { model: 'auto' };

  const binding = config.capabilities.selectedBindings[capabilityId] as RuntimeRouteBinding | null | undefined;
  if (!binding) return { model: 'auto' };

  const model = binding.model || 'auto';
  if (binding.source === 'cloud') {
    return {
      model,
      route: 'cloud',
      connectorId: binding.connectorId || undefined,
    };
  }
  return {
    model,
    route: 'local',
  };
}

export function buildParentosRuntimeMetadata(surfaceId: ParentosAISurfaceId) {
  return {
    callerKind: 'third-party-app' as const,
    callerId: 'app.nimi.parentos',
    surfaceId,
  };
}

export type ParentosTextGenerateParams = ParentosCallParams & {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type ParentosSpeechTranscribeParams = ParentosCallParams & {
  language?: string;
  responseFormat?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  timeoutMs?: number;
};

export type ParentosResolvedTextRuntimeParams = ParentosTextGenerateParams & {
  localModelId?: string;
};

export type ParentosResolvedSpeechTranscribeParams = ParentosSpeechTranscribeParams & {
  localModelId?: string;
};

export const PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS = 180_000;
const TEXT_IMAGE_INPUT_CAPABILITY = 'text.generate.vision';
const IMAGE_INPUT_UNSUPPORTED_ERROR_MESSAGE = '当前 AI 智能识别模型不支持图片识别，请在 AI 设置中为“智能识别”单独选择支持视觉输入的模型后重试。';

function getCapabilityParams(capabilityId: ParentosCapabilityId): Record<string, unknown> {
  return (useAppStore.getState().aiConfig?.capabilities.selectedParams?.[capabilityId] || {}) as Record<string, unknown>;
}

function readFiniteNumber(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readPositiveInteger(value: unknown, fallback: number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  return fallback;
}

function readTrimmedString(value: unknown, fallback: string | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function readBoolean(value: unknown, fallback: boolean | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeModelSelector(value: string): string {
  return String(value || '').trim();
}

function isQualifiedModelSelector(value: string): boolean {
  const normalized = normalizeModelSelector(value);
  return normalized.includes('/');
}

function inferLocalModelNamespace(provider: unknown): 'llama' | 'media' | 'speech' | 'sidecar' | 'local' {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized.includes('speech') || normalized.includes('stt') || normalized.includes('tts')) return 'speech';
  if (normalized.includes('media')) return 'media';
  if (normalized.includes('sidecar')) return 'sidecar';
  if (normalized.includes('llama') || normalized.includes('local')) return 'llama';
  return 'local';
}

function qualifyRuntimeModel(input: {
  model: string;
  route?: 'local' | 'cloud';
  provider?: unknown;
}): string {
  const normalizedModel = normalizeModelSelector(input.model);
  if (!normalizedModel) {
    return '';
  }
  if (isQualifiedModelSelector(normalizedModel)) {
    return normalizedModel;
  }
  if (input.route === 'cloud') {
    return `cloud/${normalizedModel}`;
  }
  return `${inferLocalModelNamespace(input.provider)}/${normalizedModel}`;
}

function normalizeRuntimeCapabilityToken(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'vision') {
    return TEXT_IMAGE_INPUT_CAPABILITY;
  }
  return normalized;
}

function supportsImageInput(capabilities: string[] | undefined): boolean {
  return (capabilities || []).some((capability) => normalizeRuntimeCapabilityToken(capability) === TEXT_IMAGE_INPUT_CAPABILITY);
}

function matchesLocalBinding(binding: RuntimeRouteBinding, candidate: {
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  model?: string;
  modelId?: string;
}): boolean {
  const bindingLocalModelId = String(binding.localModelId || binding.goRuntimeLocalModelId || '').trim();
  const candidateLocalModelId = String(candidate.localModelId || candidate.goRuntimeLocalModelId || '').trim();
  if (bindingLocalModelId && candidateLocalModelId) {
    return bindingLocalModelId === candidateLocalModelId;
  }
  const bindingModel = String(binding.modelId || binding.model || '').trim();
  const candidateModel = String(candidate.modelId || candidate.model || '').trim();
  return Boolean(bindingModel) && bindingModel === candidateModel;
}

function findImageCapableLocalBinding(snapshot: Awaited<ReturnType<typeof loadParentosRuntimeRouteOptions>>) {
  const localModel = snapshot.local.models.find((candidate) => supportsImageInput(candidate.capabilities));
  if (!localModel) {
    return null;
  }
  return {
    source: 'local' as const,
    connectorId: '',
    model: String(localModel.modelId || localModel.model || '').trim(),
    modelId: String(localModel.modelId || localModel.model || '').trim() || undefined,
    provider: String(localModel.provider || localModel.engine || '').trim() || undefined,
    localModelId: String(localModel.localModelId || '').trim() || undefined,
    engine: String(localModel.engine || '').trim() || undefined,
    endpoint: String(localModel.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(localModel.goRuntimeLocalModelId || '').trim() || undefined,
    goRuntimeStatus: String(localModel.goRuntimeStatus || '').trim() || undefined,
  } satisfies RuntimeRouteBinding;
}

function findImageCapableCloudBinding(snapshot: Awaited<ReturnType<typeof loadParentosRuntimeRouteOptions>>) {
  for (const connector of snapshot.connectors) {
    for (const model of connector.models) {
      const capabilities = connector.modelCapabilities?.[model] || [];
      if (!supportsImageInput(capabilities)) {
        continue;
      }
      return {
        source: 'cloud' as const,
        connectorId: connector.id,
        model,
        provider: String(connector.provider || '').trim() || undefined,
      } satisfies RuntimeRouteBinding;
    }
  }
  return null;
}

function bindingSupportsImageInput(
  snapshot: Awaited<ReturnType<typeof loadParentosRuntimeRouteOptions>>,
  binding: RuntimeRouteBinding | null | undefined,
): boolean {
  if (!binding) {
    return false;
  }
  if (binding.source === 'local') {
    const localModel = snapshot.local.models.find((candidate) => matchesLocalBinding(binding, candidate)) || null;
    return supportsImageInput(localModel?.capabilities);
  }
  const connector = snapshot.connectors.find((candidate) => candidate.id === binding.connectorId) || null;
  if (!connector) {
    return false;
  }
  return supportsImageInput(connector.modelCapabilities?.[binding.model]);
}

function createParentosImageInputUnsupportedError(): Error {
  return new Error(IMAGE_INPUT_UNSUPPORTED_ERROR_MESSAGE);
}

async function resolveLocalRuntimeModel(capability: ParentosCapabilityId, fallbackModel: string) {
  const snapshot = await loadParentosRuntimeRouteOptions(capability);
  const binding = snapshot.selected ?? snapshot.resolvedDefault;
  const model = qualifyRuntimeModel({
    model: String(binding?.model || fallbackModel || '').trim(),
    route: 'local',
    provider: binding?.provider || binding?.engine,
  });
  if (!model) {
    throw new Error(`ParentOS ${capability} local model is not configured`);
  }
  return {
    model,
    localModelId: String(binding?.localModelId || binding?.goRuntimeLocalModelId || '').trim() || undefined,
  };
}

export function resolveParentosTextGenerateConfig(defaults: {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
} = {}): ParentosTextGenerateParams {
  const params = getCapabilityParams('text.generate');
  return {
    ...resolveParentosBinding('text.generate'),
    temperature: readFiniteNumber(params.temperature, defaults.temperature),
    topP: readFiniteNumber(params.topP, defaults.topP),
    maxTokens: readPositiveInteger(params.maxTokens, defaults.maxTokens),
    timeoutMs: readPositiveInteger(params.timeoutMs, defaults.timeoutMs),
  };
}

export function resolveParentosTextSurfaceConfig(
  surfaceId: ParentosAISurfaceId,
  defaults: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {},
): ParentosTextGenerateParams {
  const resolved = resolveParentosTextGenerateConfig(defaults);
  const policy = getParentosAISurfacePolicy(surfaceId);
  if (!policy.localOnly) {
    return resolved;
  }
  return {
    ...resolved,
    model: resolved.route === 'cloud' ? 'auto' : resolved.model,
    route: 'local',
    connectorId: undefined,
  };
}

function resolveParentosVisionTextSurfaceConfig(
  surfaceId: ParentosAISurfaceId,
  defaults: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {},
): ParentosTextGenerateParams {
  const resolved = resolveParentosTextGenerateConfig(defaults);
  const visionBinding = resolveParentosBinding(TEXT_IMAGE_INPUT_CAPABILITY);
  const merged = visionBinding.model !== 'auto'
    ? {
      ...resolved,
      ...visionBinding,
    }
    : resolved;
  const policy = getParentosAISurfacePolicy(surfaceId);
  if (!policy.localOnly) {
    return merged;
  }
  return {
    ...merged,
    model: merged.route === 'cloud' ? 'auto' : merged.model,
    route: 'local',
    connectorId: undefined,
  };
}

export async function resolveParentosTextRuntimeConfig(
  surfaceId: ParentosAISurfaceId,
  defaults: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {},
): Promise<ParentosResolvedTextRuntimeParams> {
  const resolved = resolveParentosTextSurfaceConfig(surfaceId, defaults);
  if (resolved.route === 'cloud') {
    return {
      ...resolved,
      model: qualifyRuntimeModel({
        model: resolved.model,
        route: 'cloud',
      }),
    };
  }
  if (resolved.route !== 'local') {
    return resolved;
  }

  const local = await resolveLocalRuntimeModel('text.generate', resolved.model);
  return {
    ...resolved,
    model: local.model,
    route: 'local',
    connectorId: undefined,
    localModelId: local.localModelId,
  };
}

export async function resolveParentosImageTextRuntimeConfig(
  surfaceId: ParentosAISurfaceId,
  defaults: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {},
): Promise<ParentosResolvedTextRuntimeParams> {
  const resolved = resolveParentosVisionTextSurfaceConfig(surfaceId, defaults);
  const snapshot = await loadParentosRuntimeRouteOptions(TEXT_IMAGE_INPUT_CAPABILITY);
  const policy = getParentosAISurfacePolicy(surfaceId);
  const selectedBinding = snapshot.selected;

  let binding: RuntimeRouteBinding | null = null;

  if (selectedBinding?.source === 'local') {
    binding = bindingSupportsImageInput(snapshot, selectedBinding)
      ? selectedBinding
      : findImageCapableLocalBinding(snapshot);
  } else if (selectedBinding?.source === 'cloud' && !policy.localOnly) {
    binding = bindingSupportsImageInput(snapshot, selectedBinding)
      ? selectedBinding
      : findImageCapableCloudBinding(snapshot);
  } else {
    binding = findImageCapableLocalBinding(snapshot)
      || (!policy.localOnly ? findImageCapableCloudBinding(snapshot) : null);
  }

  if (!binding) {
    throw createParentosImageInputUnsupportedError();
  }

  if (binding.source === 'cloud') {
    return {
      ...resolved,
      model: qualifyRuntimeModel({
        model: binding.model,
        route: 'cloud',
      }),
      route: 'cloud',
      connectorId: binding.connectorId || undefined,
      localModelId: undefined,
    };
  }

  const model = qualifyRuntimeModel({
    model: binding.model || resolved.model,
    route: 'local',
    provider: binding.provider || binding.engine,
  });
  if (model) {
    return {
      ...resolved,
      model,
      route: 'local',
      connectorId: undefined,
      localModelId: String(binding.localModelId || binding.goRuntimeLocalModelId || '').trim() || undefined,
    };
  }

  const local = await resolveLocalRuntimeModel(TEXT_IMAGE_INPUT_CAPABILITY, binding.model || resolved.model);
  return {
    ...resolved,
    model: local.model,
    route: 'local',
    connectorId: undefined,
    localModelId: local.localModelId,
  };
}

export function resolveParentosSpeechTranscribeConfig(defaults: {
  language?: string;
  responseFormat?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  timeoutMs?: number;
} = {}): ParentosSpeechTranscribeParams {
  const params = getCapabilityParams('audio.transcribe');
  return {
    ...resolveParentosBinding('audio.transcribe'),
    language: readTrimmedString(params.language, defaults.language),
    responseFormat: readTrimmedString(params.responseFormat, defaults.responseFormat),
    timestamps: readBoolean(params.timestamps, defaults.timestamps),
    diarization: readBoolean(params.diarization, defaults.diarization),
    speakerCount: readPositiveInteger(params.speakerCount, defaults.speakerCount),
    prompt: readTrimmedString(params.prompt, defaults.prompt),
    timeoutMs: readPositiveInteger(params.timeoutMs, defaults.timeoutMs),
  };
}

export function resolveParentosSpeechTranscribeSurfaceConfig(
  surfaceId: ParentosAISurfaceId,
  defaults: {
    language?: string;
    responseFormat?: string;
    timestamps?: boolean;
    diarization?: boolean;
    speakerCount?: number;
    prompt?: string;
    timeoutMs?: number;
  } = {},
): ParentosSpeechTranscribeParams {
  const resolved = resolveParentosSpeechTranscribeConfig(defaults);
  const policy = getParentosAISurfacePolicy(surfaceId);
  if (!policy.localOnly) {
    return resolved;
  }
  return {
    ...resolved,
    model: resolved.route === 'cloud' ? 'auto' : resolved.model,
    route: 'local',
    connectorId: undefined,
  };
}

export async function resolveParentosSpeechTranscribeRuntimeConfig(
  surfaceId: ParentosAISurfaceId,
  defaults: {
    language?: string;
    responseFormat?: string;
    timestamps?: boolean;
    diarization?: boolean;
    speakerCount?: number;
    prompt?: string;
    timeoutMs?: number;
  } = {},
): Promise<ParentosResolvedSpeechTranscribeParams> {
  const resolved = resolveParentosSpeechTranscribeSurfaceConfig(surfaceId, defaults);
  if (resolved.route === 'cloud') {
    return {
      ...resolved,
      model: qualifyRuntimeModel({
        model: resolved.model,
        route: 'cloud',
      }),
    };
  }
  if (resolved.route !== 'local') {
    return resolved;
  }

  const local = await resolveLocalRuntimeModel('audio.transcribe', resolved.model);
  return {
    ...resolved,
    model: local.model,
    route: 'local',
    connectorId: undefined,
    localModelId: local.localModelId,
  };
}

export async function ensureParentosLocalRuntimeReady(input: {
  route?: 'local' | 'cloud';
  localModelId?: string;
  timeoutMs?: number;
}): Promise<void> {
  if (input.route !== 'local') {
    return;
  }
  const localModelId = String(input.localModelId || '').trim();
  if (!localModelId) {
    return;
  }
  const timeoutMs = typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
    ? Math.trunc(input.timeoutMs)
    : PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS;
  await getPlatformClient().runtime.local.warmLocalAsset({
    localAssetId: localModelId,
    timeoutMs,
  });
}
