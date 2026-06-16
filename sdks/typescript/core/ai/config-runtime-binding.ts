import type { NimiJsonValue } from '../contracts';
import { versionNimiAIConfig } from './config-state';
import type {
  NimiAIConfig,
  NimiAIConfigTargetRef,
  NimiAISchedulingTargetInput,
} from './config-types';
import type { NimiRuntimeAIRoutePolicy } from './runtime-model';

export type NimiAIConfigRuntimeBinding = {
  bindingCapabilityId: string;
  targetRef: NimiAIConfigTargetRef;
  model: string;
  routePolicy: Exclude<NimiRuntimeAIRoutePolicy, 'unspecified'>;
  connectorId?: string;
  schedulingTarget: NimiAISchedulingTargetInput | null;
  selectedParams: NimiJsonValue | null;
  metadata: Record<string, string>;
};

export type NimiAIConfigRuntimeBindingResult =
  | { ok: true; binding: NimiAIConfigRuntimeBinding }
  | {
      ok: false;
      reason:
        | 'binding-capability-missing'
        | 'target-ref-missing'
        | 'profile-slice-unmaterialized'
        | 'runtime-model-missing';
      message: string;
    };

export type ResolveNimiAIConfigRuntimeBindingInput = {
  config: NimiAIConfig;
  capabilityId: string;
  bindingCapabilityId: string | null | undefined;
};

export type NimiAITextGenerationParameterSet = {
  parameters: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    stop?: string[];
  };
  timeoutMs?: number;
};

export type NimiAITextGenerationParamsCoercionResult =
  | { ok: true; value: NimiAITextGenerationParameterSet }
  | {
      ok: false;
      field: string;
      message: string;
    };

type NimiAITextGenerationParamsCoercionError = Extract<NimiAITextGenerationParamsCoercionResult, { ok: false }>;

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function selectedParamsFor(
  config: NimiAIConfig,
  capabilityId: string,
  bindingCapabilityId: string,
): NimiJsonValue | null {
  return config.capabilities.selectedParams[bindingCapabilityId]
    ?? config.capabilities.selectedParams[capabilityId]
    ?? null;
}

function targetRefModel(targetRef: NimiAIConfigTargetRef): string {
  if (targetRef.kind === 'cloud-connector') {
    return normalizeText(targetRef.providerModelId);
  }
  if (targetRef.kind === 'local-runtime') {
    return normalizeText(targetRef.profileId) || normalizeText(targetRef.targetId) || normalizeText(targetRef.readinessRef);
  }
  return '';
}

function targetRefSchedulingInput(
  capability: string,
  targetRef: NimiAIConfigTargetRef,
): NimiAISchedulingTargetInput | null {
  if (targetRef.kind === 'profile-slice') {
    return null;
  }
  return { capability, targetRef };
}

export function resolveNimiAIConfigRuntimeBinding(
  input: ResolveNimiAIConfigRuntimeBindingInput,
): NimiAIConfigRuntimeBindingResult {
  const bindingCapabilityId = normalizeText(input.bindingCapabilityId);
  if (!bindingCapabilityId) {
    return {
      ok: false,
      reason: 'binding-capability-missing',
      message: `Capability ${input.capabilityId} does not have an AIConfig runtime binding path.`,
    };
  }

  const targetRef = input.config.capabilities.targetRefs[bindingCapabilityId] || null;
  if (!targetRef) {
    return {
      ok: false,
      reason: 'target-ref-missing',
      message: `AIConfig targetRef is required for ${bindingCapabilityId}; runtime invocation failed closed before request dispatch.`,
    };
  }

  if (targetRef.kind === 'profile-slice') {
    return {
      ok: false,
      reason: 'profile-slice-unmaterialized',
      message: `AIConfig targetRef for ${bindingCapabilityId} still points to profile-slice ${targetRef.sliceId}; apply/materialize a live runtime target before dispatch.`,
    };
  }

  const model = targetRefModel(targetRef);
  if (!model) {
    return {
      ok: false,
      reason: 'runtime-model-missing',
      message: `AIConfig targetRef for ${bindingCapabilityId} does not include a runtime model id.`,
    };
  }

  const connectorId = targetRef.kind === 'cloud-connector' ? normalizeText(targetRef.connectorId) : '';
  const routePolicy = targetRef.kind === 'cloud-connector' ? 'cloud' : 'local';
  const scopeRef = input.config.scopeRef;

  return {
    ok: true,
    binding: {
      bindingCapabilityId,
      targetRef,
      model,
      routePolicy,
      ...(connectorId ? { connectorId } : {}),
      schedulingTarget: targetRefSchedulingInput(bindingCapabilityId, targetRef),
      selectedParams: selectedParamsFor(input.config, input.capabilityId, bindingCapabilityId),
      metadata: {
        aiConfigScopeKind: scopeRef.kind,
        aiConfigScopeOwnerId: scopeRef.ownerId,
        aiConfigScopeSurfaceId: scopeRef.surfaceId || '',
        aiConfigProfileId: input.config.profileOrigin?.profileId || '',
        aiConfigProfileTitle: input.config.profileOrigin?.title || '',
        aiConfigCapabilityId: input.capabilityId,
        aiConfigBindingCapabilityId: bindingCapabilityId,
        aiConfigBindingSource: routePolicy,
        aiConfigBindingConnectorId: connectorId,
        aiConfigBindingModel: model,
        aiConfigTargetRefKind: targetRef.kind,
        aiConfigHash: versionNimiAIConfig(input.config),
        aiConfigBindingKeys: Object.keys(input.config.capabilities.targetRefs).sort().join(','),
      },
    },
  };
}

function paramRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
}

function optionalFiniteParam(params: Record<string, unknown>, key: string): number | NimiAITextGenerationParamsCoercionError | undefined {
  const raw = params[key];
  const value = typeof raw === 'number' ? String(raw) : normalizeText(raw);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, field: key, message: `AIConfig selectedParams.${key} must be a finite number.` };
  }
  return parsed;
}

function optionalPositiveIntegerParam(params: Record<string, unknown>, key: string): number | NimiAITextGenerationParamsCoercionError | undefined {
  const parsed = optionalFiniteParam(params, key);
  if (parsed === undefined || typeof parsed === 'object') return parsed;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, field: key, message: `AIConfig selectedParams.${key} must be a positive integer.` };
  }
  return parsed;
}

function optionalStopSequences(params: Record<string, unknown>): string[] | NimiAITextGenerationParamsCoercionError | undefined {
  const raw = params.stopSequences ?? params.stop;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      field: 'stopSequences',
      message: 'AIConfig selectedParams.stopSequences must be a string array.',
    };
  }
  const values = raw.map((entry) => normalizeText(entry)).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function isCoercionError(value: unknown): value is NimiAITextGenerationParamsCoercionError {
  return Boolean(value && typeof value === 'object' && 'ok' in value && value.ok === false);
}

export function coerceNimiAITextGenerationParams(
  selectedParams: unknown,
): NimiAITextGenerationParamsCoercionResult {
  const params = paramRecord(selectedParams);
  const temperature = optionalFiniteParam(params, 'temperature');
  if (isCoercionError(temperature)) return temperature;
  const topP = optionalFiniteParam(params, 'topP');
  if (isCoercionError(topP)) return topP;
  const topK = optionalPositiveIntegerParam(params, 'topK');
  if (isCoercionError(topK)) return topK;
  const maxTokens = optionalPositiveIntegerParam(params, 'maxTokens');
  if (isCoercionError(maxTokens)) return maxTokens;
  const presencePenalty = optionalFiniteParam(params, 'presencePenalty');
  if (isCoercionError(presencePenalty)) return presencePenalty;
  const frequencyPenalty = optionalFiniteParam(params, 'frequencyPenalty');
  if (isCoercionError(frequencyPenalty)) return frequencyPenalty;
  const timeoutMs = optionalPositiveIntegerParam(params, 'timeoutMs');
  if (isCoercionError(timeoutMs)) return timeoutMs;
  const stop = optionalStopSequences(params);
  if (isCoercionError(stop)) return stop;

  return {
    ok: true,
    value: {
      parameters: {
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { topP } : {}),
        ...(topK !== undefined ? { topK } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(presencePenalty !== undefined ? { presencePenalty } : {}),
        ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
        ...(stop !== undefined ? { stop } : {}),
      },
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
}
