import type { NimiAIConfig, NimiAIConfigTargetRef } from '@nimiplatform/kit/core/sdk-contract';
import { summarizeTargetRef } from '@nimiplatform/kit/core/model-config';
import { localRuntimeRefCandidates } from './local-runtime-status.js';

export type ModelConfigRuntimeTargetStatus = 'ready' | 'blocked' | 'checking';
export type ModelConfigRuntimeTargetSource = 'local' | 'cloud' | 'profile-slice' | 'unknown';
export type ModelConfigRuntimeTargetParamRecord = Record<string, unknown>;

export type ModelConfigRuntimeTargetLocalModel = {
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  profileBindingId?: string;
  readinessRef?: string;
  modelId?: string;
  model?: string;
  label?: string;
  engine?: string;
};

export type ModelConfigRuntimeTargetSummary = {
  capabilityId: string;
  bindingCapabilityId: string | null;
  status: ModelConfigRuntimeTargetStatus;
  source: ModelConfigRuntimeTargetSource;
  modelLabel: string;
  detail: string;
  canDispatch: boolean;
  params: ModelConfigRuntimeTargetParamRecord;
  paramsSummary: string[];
  profileOrigin: string | null;
};

export type SummarizeModelConfigRuntimeTargetInput = {
  capabilityId: string;
  bindingCapabilityId: string | null | undefined;
  config: NimiAIConfig | null;
  runtimeStatus?: 'checking' | 'ready' | 'blocked';
  runtimeDetail?: string | null;
  localModels?: readonly ModelConfigRuntimeTargetLocalModel[];
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactModelLabel(value: string): string {
  const normalized = value.trim();
  return normalized.replace(/^(local-import|local|cloud)\//i, '').trim() || normalized;
}

function isOpaqueRuntimeId(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);
  return /^[0-9A-HJKMNP-TV-Z]{20,32}$/u.test(normalized);
}

function containsOpaqueRuntimeId(value: string): boolean {
  return value.split(/[:/\s]+/u).some((part) => isOpaqueRuntimeId(part));
}

function localTargetCandidates(targetRef: NimiAIConfigTargetRef): string[] {
  if (targetRef.kind !== 'local-runtime') return [];
  const candidates = [
    ...localRuntimeRefCandidates(targetRef.profileBindingId),
    ...localRuntimeRefCandidates(targetRef.readinessRef),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function localModelMatchesTarget(
  model: ModelConfigRuntimeTargetLocalModel,
  candidates: readonly string[],
): boolean {
  const modelValues = [
    normalizeText(model.localModelId),
    normalizeText(model.goRuntimeLocalModelId),
    normalizeText(model.profileBindingId),
    normalizeText(model.readinessRef),
    normalizeText(model.modelId),
    normalizeText(model.model),
    normalizeText(model.label),
  ].filter(Boolean);
  return candidates.some((candidate) => modelValues.includes(candidate));
}

function localRuntimeFallbackLabel(targetRef: NimiAIConfigTargetRef): string {
  if (targetRef.kind !== 'local-runtime') return 'Local runtime model';
  const raw = normalizeText(targetRef.profileBindingId)
    || normalizeText(targetRef.readinessRef);
  if (!raw || containsOpaqueRuntimeId(raw)) return 'Local runtime model';
  return compactModelLabel(raw);
}

function localRuntimeModelLabel(
  targetRef: NimiAIConfigTargetRef,
  localModels: readonly ModelConfigRuntimeTargetLocalModel[],
): string {
  const candidates = localTargetCandidates(targetRef);
  const match = candidates.length > 0
    ? localModels.find((model) => localModelMatchesTarget(model, candidates))
    : null;
  if (!match) return localRuntimeFallbackLabel(targetRef);
  return compactModelLabel(
    normalizeText(match.label)
    || normalizeText(match.modelId)
    || normalizeText(match.model)
    || normalizeText(match.localModelId)
    || normalizeText(match.goRuntimeLocalModelId)
    || 'Local runtime model',
  );
}

function targetModelLabel(
  targetRef: NimiAIConfigTargetRef,
  localModels: readonly ModelConfigRuntimeTargetLocalModel[] = [],
): string {
  if (targetRef.kind === 'cloud-connector') {
    return compactModelLabel(normalizeText(targetRef.providerModelId) || normalizeText(targetRef.connectorId) || 'Cloud connector');
  }
  if (targetRef.kind === 'local-runtime') {
    return localRuntimeModelLabel(targetRef, localModels);
  }
  return compactModelLabel(normalizeText(targetRef.sourceProfileId) || normalizeText(targetRef.sliceId) || 'Profile slice');
}

function targetSource(targetRef: NimiAIConfigTargetRef): ModelConfigRuntimeTargetSource {
  if (targetRef.kind === 'cloud-connector') return 'cloud';
  if (targetRef.kind === 'local-runtime') return 'local';
  return 'profile-slice';
}

function selectedParamRecord(config: NimiAIConfig, capabilityId: string, bindingCapabilityId: string | null): Record<string, unknown> {
  const raw = (bindingCapabilityId ? config.capabilities.selectedParams[bindingCapabilityId] : undefined)
    ?? config.capabilities.selectedParams[capabilityId]
    ?? null;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
}

function toSerializableParamValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(toSerializableParamValue).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = toSerializableParamValue(child);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return undefined;
}

function serializableParamRecord(params: Record<string, unknown>): ModelConfigRuntimeTargetParamRecord {
  const out: ModelConfigRuntimeTargetParamRecord = {};
  for (const [key, value] of Object.entries(params)) {
    const next = toSerializableParamValue(value);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function hasParam(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function textParam(value: unknown): string {
  if (Array.isArray(value)) return String(value.length);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value).trim();
}

function countObjectValues(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).filter(hasParam).length;
}

function pushParam(out: string[], params: Record<string, unknown>, key: string, label: string = key): void {
  const value = params[key];
  if (hasParam(value)) out.push(`${label} ${textParam(value)}`);
}

function summarizeParams(capabilityId: string, params: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (capabilityId === 'text.generate' || capabilityId === 'chat.stream') {
    pushParam(out, params, 'tone');
    pushParam(out, params, 'length');
    pushParam(out, params, 'temperature', 'temp');
    pushParam(out, params, 'topP');
    pushParam(out, params, 'topK');
    pushParam(out, params, 'maxTokens', 'max');
    pushParam(out, params, 'timeoutMs', 'timeout');
    if (Array.isArray(params.stopSequences) && params.stopSequences.length > 0) out.push(`stop ${params.stopSequences.length}`);
    pushParam(out, params, 'presencePenalty', 'presence');
    pushParam(out, params, 'frequencyPenalty', 'frequency');
  } else if (capabilityId === 'image.generate') {
    pushParam(out, params, 'size');
    pushParam(out, params, 'steps');
    pushParam(out, params, 'cfgScale', 'cfg');
    pushParam(out, params, 'seed');
    pushParam(out, params, 'timeoutMs', 'timeout');
    const companions = countObjectValues(params.companionSlots);
    if (companions > 0) out.push(`${companions} companion`);
  } else if (capabilityId === 'video.generate') {
    pushParam(out, params, 'mode');
    pushParam(out, params, 'ratio');
    pushParam(out, params, 'durationSec', 'duration');
    pushParam(out, params, 'resolution');
    pushParam(out, params, 'fps');
    pushParam(out, params, 'seed');
    pushParam(out, params, 'timeoutMs', 'timeout');
  } else if (capabilityId === 'audio.synthesize') {
    pushParam(out, params, 'responseFormat', 'format');
    pushParam(out, params, 'languageHint', 'lang');
    pushParam(out, params, 'speakingRate', 'speed');
    pushParam(out, params, 'volume');
    pushParam(out, params, 'pitchSemitones', 'pitch');
    pushParam(out, params, 'timeoutMs', 'timeout');
  } else if (capabilityId === 'audio.transcribe') {
    pushParam(out, params, 'language', 'lang');
    pushParam(out, params, 'responseFormat', 'format');
    pushParam(out, params, 'speakerCount', 'speakers');
    pushParam(out, params, 'timeoutMs', 'timeout');
    pushParam(out, params, 'timestamps');
    pushParam(out, params, 'diarization');
  }
  return out.slice(0, 6);
}

function profileOriginLabel(config: NimiAIConfig): string | null {
  const origin = config.profileOrigin;
  if (!origin) return null;
  return normalizeText(origin.title) || normalizeText(origin.profileId) || null;
}

export function summarizeModelConfigRuntimeTarget(
  input: SummarizeModelConfigRuntimeTargetInput,
): ModelConfigRuntimeTargetSummary {
  const bindingCapabilityId = normalizeText(input.bindingCapabilityId) || null;
  const localModels = input.localModels || [];
  const params = input.config ? serializableParamRecord(selectedParamRecord(input.config, input.capabilityId, bindingCapabilityId)) : {};
  const base = {
    capabilityId: input.capabilityId,
    bindingCapabilityId,
    params,
    paramsSummary: summarizeParams(bindingCapabilityId || input.capabilityId, params),
    profileOrigin: input.config ? profileOriginLabel(input.config) : null,
  };

  if (input.runtimeStatus === 'checking') {
    return {
      ...base,
      status: 'checking',
      source: 'unknown',
      modelLabel: 'Checking Runtime',
      detail: 'Runtime inspection has not completed yet.',
      canDispatch: false,
    };
  }
  if (input.runtimeStatus === 'blocked') {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      modelLabel: 'Runtime unavailable',
      detail: input.runtimeDetail || 'Runtime is unavailable.',
      canDispatch: false,
    };
  }
  if (!input.config || !bindingCapabilityId) {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      modelLabel: 'Target required',
      detail: `Capability ${input.capabilityId} does not have a Runtime model binding path.`,
      canDispatch: false,
    };
  }

  const targetRef = input.config.capabilities.targetRefs[bindingCapabilityId] || null;
  if (!targetRef) {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      modelLabel: 'Target required',
      detail: `Choose a Runtime model target for ${bindingCapabilityId} before running this test.`,
      canDispatch: false,
    };
  }
  if (targetRef.kind === 'profile-slice') {
    const targetSummary = summarizeTargetRef(targetRef);
    return {
      ...base,
      status: 'blocked',
      source: 'profile-slice',
      modelLabel: targetModelLabel(targetRef, localModels),
      detail: targetSummary.detail
        ? `Apply or materialize ${targetSummary.label}: ${targetSummary.detail} into a live Runtime target before dispatch.`
        : `Apply or materialize profile slice ${targetRef.sliceId} into a live Runtime target before dispatch.`,
      canDispatch: false,
    };
  }

  return {
    ...base,
    status: 'ready',
    source: targetSource(targetRef),
    modelLabel: targetModelLabel(targetRef, localModels),
    detail: `${bindingCapabilityId} is bound to a ${targetRef.kind === 'cloud-connector' ? 'cloud connector' : 'local Runtime'} target.`,
    canDispatch: true,
  };
}
