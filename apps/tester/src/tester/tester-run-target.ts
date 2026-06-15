import type {
  NimiAIConfig,
  NimiAIConfigTargetRef,
} from '@nimiplatform/sdk/ai';
import type {
  TesterCapability,
  TesterCapabilityId,
} from './tester-capabilities.js';
import type { TesterRuntimeInspection } from './tester-runtime.js';
import { CAPABILITY_TO_SECTION } from './tester-capability-sections.js';

export type TesterRunTargetStatus = 'ready' | 'blocked' | 'checking' | 'tauri-only' | 'sdk-gap';
export type TesterRunTargetSource = 'local' | 'cloud' | 'profile-slice' | 'local-fixture' | 'unknown';

export type TesterRunTargetSummary = {
  capabilityId: TesterCapabilityId;
  bindingCapabilityId: string | null;
  section: string;
  status: TesterRunTargetStatus;
  source: TesterRunTargetSource;
  modelLabel: string;
  detail: string;
  canDispatch: boolean;
  paramsSummary: string[];
  profileOrigin: string | null;
};

function bindingCapabilityFor(capabilityId: TesterCapabilityId): string | null {
  if (capabilityId === 'text.generate' || capabilityId === 'chat.stream') return 'text.generate';
  if (capabilityId === 'text.embed') return 'text.embed';
  if (capabilityId === 'speech.bundle') return 'audio.synthesize';
  if (
    capabilityId === 'image.generate'
    || capabilityId === 'video.generate'
    || capabilityId === 'audio.synthesize'
    || capabilityId === 'audio.transcribe'
  ) {
    return capabilityId;
  }
  return null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactModelLabel(value: string): string {
  const normalized = value.trim();
  return normalized.replace(/^(local-import|local|cloud)\//i, '').trim() || normalized;
}

function targetModelLabel(targetRef: NimiAIConfigTargetRef): string {
  if (targetRef.kind === 'cloud-connector') {
    return compactModelLabel(normalizeText(targetRef.providerModelId) || normalizeText(targetRef.connectorId) || 'Cloud connector');
  }
  if (targetRef.kind === 'local-runtime') {
    return compactModelLabel(
      normalizeText(targetRef.profileId)
      || normalizeText(targetRef.targetId)
      || normalizeText(targetRef.readinessRef)
      || 'Local runtime target',
    );
  }
  return compactModelLabel(normalizeText(targetRef.sourceProfileId) || normalizeText(targetRef.sliceId) || 'Profile slice');
}

function targetSource(targetRef: NimiAIConfigTargetRef): TesterRunTargetSource {
  if (targetRef.kind === 'cloud-connector') return 'cloud';
  if (targetRef.kind === 'local-runtime') return 'local';
  return 'profile-slice';
}

function paramRecord(config: NimiAIConfig, capabilityId: TesterCapabilityId, bindingCapabilityId: string | null): Record<string, unknown> {
  const raw = (bindingCapabilityId ? config.capabilities.selectedParams[bindingCapabilityId] : undefined)
    ?? config.capabilities.selectedParams[capabilityId]
    ?? null;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
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

function summarizeParams(capabilityId: TesterCapabilityId, params: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (capabilityId === 'text.generate' || capabilityId === 'chat.stream') {
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

export function createTesterRunTargetSummary(input: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  config: NimiAIConfig | null;
}): TesterRunTargetSummary {
  const { capability, runtime, config } = input;
  const section = CAPABILITY_TO_SECTION[capability.id];
  const bindingCapabilityId = bindingCapabilityFor(capability.id);
  const base = {
    capabilityId: capability.id,
    bindingCapabilityId,
    section,
    paramsSummary: config ? summarizeParams(capability.id, paramRecord(config, capability.id, bindingCapabilityId)) : [],
    profileOrigin: config ? profileOriginLabel(config) : null,
  };

  if (capability.execution === 'standalone-tauri') {
    return {
      ...base,
      status: 'tauri-only',
      source: 'local-fixture',
      modelLabel: 'Local fixture',
      detail: 'This lane opens the standalone Tauri viewer and does not use Runtime model routing.',
      canDispatch: true,
    };
  }
  if (capability.execution === 'typed-unavailable') {
    return {
      ...base,
      status: 'sdk-gap',
      source: 'unknown',
      modelLabel: 'SDK surface missing',
      detail: capability.missingSurface || 'No admitted typed SDK method is available for this capability.',
      canDispatch: false,
    };
  }
  if (!runtime) {
    return {
      ...base,
      status: 'checking',
      source: 'unknown',
      modelLabel: 'Checking Runtime',
      detail: 'Runtime inspection has not completed yet.',
      canDispatch: false,
    };
  }
  if (runtime.status !== 'ready') {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      modelLabel: 'Runtime unavailable',
      detail: runtime.detail,
      canDispatch: false,
    };
  }
  if (!config || !bindingCapabilityId) {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      modelLabel: 'Target required',
      detail: `Capability ${capability.id} does not have a Runtime model binding path.`,
      canDispatch: false,
    };
  }

  const targetRef = config.capabilities.targetRefs[bindingCapabilityId] || null;
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
    return {
      ...base,
      status: 'blocked',
      source: 'profile-slice',
      modelLabel: targetModelLabel(targetRef),
      detail: `Apply or materialize profile slice ${targetRef.sliceId} into a live Runtime target before dispatch.`,
      canDispatch: false,
    };
  }

  return {
    ...base,
    status: 'ready',
    source: targetSource(targetRef),
    modelLabel: targetModelLabel(targetRef),
    detail: `${bindingCapabilityId} is bound to a ${targetRef.kind === 'cloud-connector' ? 'cloud connector' : 'local Runtime'} target.`,
    canDispatch: true,
  };
}
