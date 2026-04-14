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
  if (resolved.route !== 'local') {
    return {
      ...resolved,
      model: qualifyRuntimeModel({
        model: resolved.model,
        route: 'cloud',
      }),
    };
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
  if (resolved.route !== 'local') {
    return {
      ...resolved,
      model: qualifyRuntimeModel({
        model: resolved.model,
        route: 'cloud',
      }),
    };
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
    : 60_000;
  await getPlatformClient().runtime.local.warmLocalAsset({
    localAssetId: localModelId,
    timeoutMs,
  });
}
