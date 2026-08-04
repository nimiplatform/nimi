import type { NimiCapabilityAIConfig } from '@nimiplatform/sdk/ai';

import type {
  TesterCapability,
  TesterCapabilityId,
} from './tester-capabilities.js';
import { getTesterCapabilityContract } from './tester-capabilities.js';
import { CAPABILITY_TO_SECTION } from './tester-capability-sections.js';
import { findTesterCapabilityIntent } from './tester-ai-config-store.js';
import type { TesterRuntimeInspection } from './tester-runtime.js';

export type TesterRunTargetStatus =
  | 'checking'
  | 'configured'
  | 'blocked'
  | 'tauri-only'
  | 'sdk-gap'
  | 'not-admitted';
export type TesterRunTargetSource = 'local' | 'cloud' | 'unknown' | 'local-fixture';
export type TesterRunTargetParamRecord = Readonly<Record<string, unknown>>;

export type TesterRunTargetSummary = {
  capabilityId: TesterCapabilityId;
  capabilityContract: string | null;
  section: string;
  status: TesterRunTargetStatus;
  source: TesterRunTargetSource;
  modelLabel: string;
  detail: string;
  canDispatch: boolean;
  params: TesterRunTargetParamRecord;
  paramsSummary: readonly string[];
  profileOrigin: null;
};

export function createTesterRunTargetSummary(input: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  config: NimiCapabilityAIConfig | null;
  configState?: 'loading' | 'loaded' | 'failed';
  configError?: string | null;
  standaloneTauriAvailable?: boolean;
}): TesterRunTargetSummary {
  const { capability, runtime, config } = input;
  const section = CAPABILITY_TO_SECTION[capability.id];
  const capabilityContract = capability.capabilityContract
    ?? getTesterCapabilityContract(capability.id)
    ?? (capability.id === 'text.generate' ? 'text.generate' : null);
  const base = {
    capabilityId: capability.id,
    capabilityContract,
    section,
    params: {},
    paramsSummary: [],
    profileOrigin: null,
  } as const;

  if (capability.execution === 'standalone-tauri') {
    const canDispatch = input.standaloneTauriAvailable === true;
    return {
      ...base,
      status: 'tauri-only',
      source: 'local-fixture',
      modelLabel: 'Local fixture',
      detail: canDispatch
        ? 'This lane opens the standalone Tauri viewer and does not use Runtime AI configuration.'
        : 'This lane requires the standalone Tauri shell; the current shell cannot open its viewer.',
      canDispatch,
    };
  }
  if (capability.execution === 'typed-unavailable' || !capabilityContract) {
    return {
      ...base,
      status: 'sdk-gap',
      source: 'unknown',
      modelLabel: 'Capability unavailable',
      detail: capability.missingSurface || 'No admitted typed SDK method is available for this capability.',
      canDispatch: false,
    };
  }
  if (!runtime) {
    return {
      ...base,
      status: 'checking',
      source: 'unknown',
      modelLabel: 'Checking configuration',
      detail: 'Reading the current App AIConfig and Runtime connection.',
      canDispatch: false,
    };
  }
  if (runtime.status !== 'connected' && runtime.status !== 'simulated') {
    return {
      ...base,
      status: 'not-admitted',
      source: 'unknown',
      modelLabel: 'Runtime unavailable',
      detail: runtime.detail,
      canDispatch: false,
    };
  }
  if (input.configState === 'loading') {
    return {
      ...base,
      status: 'checking',
      source: 'unknown',
      modelLabel: 'Reading App AIConfig',
      detail: 'Reading the current Runtime-owned App AIConfig.',
      canDispatch: false,
    };
  }
  if (input.configState === 'failed') {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      modelLabel: 'AIConfig unavailable',
      detail: input.configError || 'The current App AIConfig could not be read.',
      canDispatch: false,
    };
  }

  const intent = findTesterCapabilityIntent(config, capabilityContract);
  if (!intent) {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      modelLabel: 'Not configured',
      detail: 'This App AIConfig has no intent for the capability. Choose Local to save one.',
      canDispatch: false,
    };
  }
  const route = intent.route;
  if (route.oneofKind === 'local') {
    return {
      ...base,
      status: 'configured',
      source: 'local',
      modelLabel: 'Local',
      detail: 'The App selected Local. Runtime resolves the current machine selection when execution begins; configuration does not prove execution readiness.',
      canDispatch: true,
    };
  }
  if (route.oneofKind === 'cloud' && 'cloud' in route) {
    const grantSelected = Boolean(route.cloud.connectorGrantId.trim());
    return {
      ...base,
      status: grantSelected ? 'configured' : 'blocked',
      source: 'cloud',
      modelLabel: grantSelected ? 'Cloud' : 'Cloud selection required',
      detail: grantSelected
        ? 'The App selected an exact Cloud implementation and ConnectorGrant. Configuration does not prove provider availability.'
        : 'The Cloud intent has no ConnectorGrant selection and remains unresolved.',
      canDispatch: grantSelected,
    };
  }

  return {
    ...base,
    status: 'blocked',
    source: 'unknown',
    modelLabel: 'Invalid configuration',
    detail: 'The capability intent has no supported route.',
    canDispatch: false,
  };
}
