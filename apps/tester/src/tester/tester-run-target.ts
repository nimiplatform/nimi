import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import {
  summarizeModelConfigRuntimeTarget,
  type ModelConfigRuntimeTargetLocalModel,
  type ModelConfigRuntimeTargetParamRecord,
  type ModelConfigRuntimeTargetSource,
  type ModelConfigRuntimeTargetStatus,
} from '@nimiplatform/kit/features/model-config/headless';
import type {
  TesterCapability,
  TesterCapabilityId,
} from './tester-capabilities.js';
import { getTesterRuntimeBindingCapabilityId } from './tester-capabilities.js';
import { CAPABILITY_TO_SECTION } from './tester-capability-sections.js';
import type { TesterRuntimeInspection } from './tester-runtime.js';

export type TesterRunTargetStatus = ModelConfigRuntimeTargetStatus | 'tauri-only' | 'sdk-gap';
export type TesterRunTargetSource = ModelConfigRuntimeTargetSource | 'local-fixture';
export type TesterRunTargetParamRecord = ModelConfigRuntimeTargetParamRecord;

export type TesterRunTargetSummary = {
  capabilityId: TesterCapabilityId;
  bindingCapabilityId: string | null;
  section: string;
  status: TesterRunTargetStatus;
  source: TesterRunTargetSource;
  modelLabel: string;
  detail: string;
  canDispatch: boolean;
  params: TesterRunTargetParamRecord;
  paramsSummary: string[];
  profileOrigin: string | null;
};

export type TesterRunTargetLocalModel = ModelConfigRuntimeTargetLocalModel;

function runtimeStatus(runtime: TesterRuntimeInspection | null): 'checking' | 'ready' | 'blocked' {
  if (!runtime) return 'checking';
  return runtime.status === 'ready' ? 'ready' : 'blocked';
}

export function createTesterRunTargetSummary(input: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  config: NimiAIConfig | null;
  localModels?: readonly TesterRunTargetLocalModel[];
}): TesterRunTargetSummary {
  const { capability, runtime, config } = input;
  const section = CAPABILITY_TO_SECTION[capability.id];
  const bindingCapabilityId = capability.runtimeBindingCapabilityId ?? getTesterRuntimeBindingCapabilityId(capability.id);
  const summary = summarizeModelConfigRuntimeTarget({
    capabilityId: capability.id,
    bindingCapabilityId,
    config,
    runtimeStatus: runtimeStatus(runtime),
    runtimeDetail: runtime?.detail,
    localModels: input.localModels,
  });

  const base = {
    capabilityId: capability.id,
    bindingCapabilityId,
    section,
    params: summary.params,
    paramsSummary: summary.paramsSummary,
    profileOrigin: summary.profileOrigin,
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

  return {
    ...summary,
    capabilityId: capability.id,
    section,
  };
}
