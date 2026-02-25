import type { ModelProfile, ProviderType } from '../types';
import {
  DEFAULT_LOCAL_RUNTIME_ENDPOINT,
  DEFAULT_OPENAI_ENDPOINT,
  type LocalAiProviderHints,
  type ProviderNamespace,
  type ProviderPlan,
} from './types';

function normalizeEndpoint(endpoint: string | undefined, fallback: string) {
  return String(endpoint || fallback).replace(/\/+$/, '');
}

function asOpenAiCompatibleEndpoint(endpoint: string): string {
  const normalized = normalizeEndpoint(endpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT);
  if (normalized.endsWith('/v1')) return normalized;
  return `${normalized}/v1`;
}

function normalizeProviderNamespace(input: unknown): ProviderNamespace {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) return 'localai';
  if (normalized === 'nexa' || normalized.startsWith('nexa-')) return 'nexa';
  if (normalized === 'localai') return 'localai';
  return normalized;
}

function isKnownLocalRuntimeProviderNamespace(input: unknown): boolean {
  const normalized = normalizeProviderNamespace(input);
  return normalized === 'localai' || normalized === 'nexa';
}

function normalizeProviderAdapter(
  input: unknown,
  fallback: 'openai_compat_adapter' | 'localai_native_adapter' = 'openai_compat_adapter',
): 'openai_compat_adapter' | 'localai_native_adapter' {
  const normalized = String(input || '').trim().toLowerCase();
  if (normalized === 'localai_native_adapter') return 'localai_native_adapter';
  if (normalized === 'openai_compat_adapter') return 'openai_compat_adapter';
  return fallback;
}

type ProviderPlanModality =
  | 'chat'
  | 'embedding'
  | 'stt'
  | 'tts'
  | 'image'
  | 'video'
  | 'rerank'
  | 'cv'
  | 'diarize'
  | '';

function normalizePlanModality(input: unknown): ProviderPlanModality {
  const normalized = String(input || '').trim().toLowerCase();
  if (
    normalized === 'embedding'
    || normalized === 'stt'
    || normalized === 'tts'
    || normalized === 'image'
    || normalized === 'video'
    || normalized === 'rerank'
    || normalized === 'cv'
    || normalized === 'diarize'
  ) {
    return normalized;
  }
  if (normalized === 'chat') {
    return 'chat';
  }
  return '';
}

function defaultAdapterForProviderModality(
  providerNamespace: ProviderNamespace,
  modality: ProviderPlanModality,
): 'openai_compat_adapter' | 'localai_native_adapter' {
  if (providerNamespace === 'nexa') {
    if (modality === 'rerank' || modality === 'cv' || modality === 'diarize') {
      return 'localai_native_adapter';
    }
    return 'openai_compat_adapter';
  }
  if (modality === 'chat' || modality === 'embedding' || modality === '') {
    return 'openai_compat_adapter';
  }
  return 'localai_native_adapter';
}

function adapterMatchesProviderModality(input: {
  providerNamespace: ProviderNamespace;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter';
  modality: ProviderPlanModality;
}): boolean {
  if (!input.modality) {
    return true;
  }
  if (input.providerNamespace === 'nexa') {
    if (input.modality === 'video') {
      return false;
    }
    if (
      input.modality === 'chat'
      || input.modality === 'embedding'
      || input.modality === 'stt'
      || input.modality === 'tts'
      || input.modality === 'image'
    ) {
      return input.adapter === 'openai_compat_adapter';
    }
    if (
      input.modality === 'rerank'
      || input.modality === 'cv'
      || input.modality === 'diarize'
    ) {
      return input.adapter === 'localai_native_adapter';
    }
  }
  if (input.providerNamespace === 'localai') {
    if (input.modality === 'chat' || input.modality === 'embedding') {
      return input.adapter === 'openai_compat_adapter';
    }
    if (
      input.modality === 'stt'
      || input.modality === 'tts'
      || input.modality === 'image'
      || input.modality === 'video'
    ) {
      return input.adapter === 'localai_native_adapter';
    }
  }
  return true;
}

function parseProviderRef(provider: string) {
  const providerRef = String(provider || '').trim();
  if (!providerRef) throw new Error('PLAY_PROVIDER_UNAVAILABLE: provider required');
  const lowered = providerRef.toLowerCase();
  const parts = providerRef.split(':').map((segment) => segment.trim()).filter(Boolean);
  const firstPart = parts[0] || '';
  if (firstPart.toLowerCase() === 'local-runtime') {
    if (parts.length === 1) {
      return {
        providerKind: 'OPENAI_COMPATIBLE' as const,
        providerRef,
        providerNamespace: 'localai' as const,
        adapterHint: undefined,
        modelHint: '',
      };
    }

    const providerNamespace = normalizeProviderNamespace(parts[1] || '');
    if (!isKnownLocalRuntimeProviderNamespace(providerNamespace)) {
      throw new Error(
        `LOCAL_AI_CAPABILITY_MISSING: unsupported local-runtime provider namespace=${String(parts[1] || 'unknown')}`,
      );
    }

    const adapterToken = String(parts[2] || '').toLowerCase();
    const hasAdapterToken = adapterToken === 'openai_compat_adapter' || adapterToken === 'localai_native_adapter';
    const adapterHint = hasAdapterToken
      ? (adapterToken as 'openai_compat_adapter' | 'localai_native_adapter')
      : undefined;
    const modelHint = hasAdapterToken
      ? parts.slice(3).join(':').trim()
      : parts.slice(2).join(':').trim();

    return {
      providerKind: 'OPENAI_COMPATIBLE' as const,
      providerRef,
      providerNamespace,
      adapterHint,
      modelHint,
    };
  }

  if (lowered.startsWith('openrouter') || lowered.startsWith('openai-compatible') || lowered.startsWith('openai')) {
    return {
      providerKind: 'OPENAI_COMPATIBLE' as const,
      providerRef,
      providerNamespace: 'localai' as const,
      adapterHint: undefined,
      modelHint: providerRef.includes(':') ? providerRef.split(':').slice(1).join(':').trim() : '',
    };
  }
  return {
    providerKind: 'FALLBACK' as const,
    providerRef,
    providerNamespace: 'localai' as const,
    adapterHint: undefined,
    modelHint: providerRef.includes(':') ? providerRef.split(':').slice(1).join(':').trim() : '',
  };
}

function preferredAdapterFromHints(
  hints: LocalAiProviderHints | undefined,
  providerNamespace: ProviderNamespace,
): unknown {
  if (providerNamespace === 'nexa') {
    return hints?.nexa?.preferredAdapter;
  }
  return hints?.localai?.preferredAdapter;
}

export function resolveProviderExecutionPlan(input: {
  provider: string;
  modality?: ProviderPlanModality | string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  providerHints?: LocalAiProviderHints;
}): ProviderPlan {
  const parsed = parseProviderRef(input.provider);
  const modality = normalizePlanModality(input.modality);
  if (parsed.providerNamespace === 'nexa' && modality === 'video') {
    throw new Error('LOCAL_AI_CAPABILITY_MISSING: nexa provider does not expose video modality');
  }
  const defaultAdapter = defaultAdapterForProviderModality(parsed.providerNamespace, modality);
  const preferredAdapter = normalizeProviderAdapter(
    preferredAdapterFromHints(input.providerHints, parsed.providerNamespace) || parsed.adapterHint,
    defaultAdapter,
  );
  if (parsed.adapterHint && parsed.adapterHint !== preferredAdapter) {
    throw new Error(
      `LOCAL_AI_ADAPTER_MISMATCH: route=${parsed.adapterHint} hint=${preferredAdapter}`,
    );
  }
  if (!adapterMatchesProviderModality({
    providerNamespace: parsed.providerNamespace,
    adapter: preferredAdapter,
    modality,
  })) {
    throw new Error(
      `LOCAL_AI_ADAPTER_MISMATCH: provider=${parsed.providerNamespace} modality=${modality || 'unknown'} adapter=${preferredAdapter}`,
    );
  }
  if (parsed.providerKind === 'OPENAI_COMPATIBLE') {
    const normalizedRef = parsed.providerRef.toLowerCase();
    const preferLocalEndpoint = normalizedRef.startsWith('local-runtime')
      || normalizedRef.startsWith('local');
    const providerKind = preferredAdapter === 'localai_native_adapter'
      ? 'LOCALAI_NATIVE'
      : 'OPENAI_COMPATIBLE';
    return {
      providerKind,
      providerNamespace: parsed.providerNamespace,
      providerRef: parsed.providerRef,
      modelHint: parsed.modelHint,
      adapter: preferredAdapter,
      providerHints: input.providerHints,
      endpoint: preferLocalEndpoint
        ? asOpenAiCompatibleEndpoint(
            normalizeEndpoint(input.localProviderEndpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT),
          )
        : normalizeEndpoint(input.localOpenAiEndpoint, DEFAULT_OPENAI_ENDPOINT),
      model: parsed.modelHint || input.localProviderModel || 'local-model',
    };
  }
  return {
    providerKind: 'FALLBACK',
    providerNamespace: parsed.providerNamespace,
    providerRef: parsed.providerRef,
    modelHint: parsed.modelHint,
    adapter: 'openai_compat_adapter',
    providerHints: input.providerHints,
    endpoint: null,
    model: parsed.modelHint || input.localProviderModel || 'local-fallback',
  };
}

export function resolveAdapterType(plan: ProviderPlan): ProviderType {
  if (plan.providerKind === 'FALLBACK') return 'FALLBACK';
  if (plan.adapter === 'localai_native_adapter') return 'LOCALAI_NATIVE';
  return 'OPENAI_COMPATIBLE';
}

export function buildPlanModelProfile(plan: ProviderPlan): ModelProfile {
  const profileIdPrefix = `${plan.providerKind.toLowerCase()}:${plan.providerNamespace}`;
  const providerType = resolveAdapterType(plan);
  return {
    id: `${profileIdPrefix}:${plan.model}`,
    providerType,
    model: plan.model,
    endpoint: plan.endpoint ?? 'fallback://local',
    capabilities: ['chat'],
    constraints: {
      allowStreaming: true,
      allowToolUse: true,
    },
    healthStatus: plan.providerKind === 'FALLBACK' ? 'unsupported' : 'healthy',
  };
}
