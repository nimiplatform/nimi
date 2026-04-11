import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { useAppStore } from '../../app-shell/app-store.js';
import type { ParentosCapabilityId } from './parentos-ai-config.js';

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
