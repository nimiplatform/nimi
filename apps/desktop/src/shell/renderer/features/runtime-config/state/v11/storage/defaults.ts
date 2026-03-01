import { DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11 } from '../types/connector';
import type { RuntimeConfigStateV11 } from '../types';

export const RUNTIME_CONFIG_STORAGE_KEY_V11 = 'nimi:runtime-config:v11';

export type RuntimeConfigSeedV11 = {
  localProviderEndpoint?: string;
  localOpenAiEndpoint?: string;
  localProviderModel?: string;
  provider?: string;
  connectorId?: string;
  runtimeModelType?: string;
};

export type StoredStateV11 = {
  version: 11;
  initializedByV11: boolean;
  activeSection: RuntimeConfigStateV11['activeSection'];
  activeSetupPage: RuntimeConfigStateV11['activeSetupPage'];
  diagnosticsCollapsed: boolean;
  uiMode: RuntimeConfigStateV11['uiMode'];
  selectedSource: RuntimeConfigStateV11['selectedSource'];
  activeCapability: RuntimeConfigStateV11['activeCapability'];
  localRuntime: RuntimeConfigStateV11['localRuntime'];
};

export function createDefaultStateV11(seed: RuntimeConfigSeedV11): RuntimeConfigStateV11 {
  const endpoint = String(seed.localProviderEndpoint || seed.localOpenAiEndpoint || DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11).trim();
  return {
    version: 11,
    initializedByV11: false,
    activeSection: 'setup',
    activeSetupPage: 'overview',
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: 'local-runtime',
    activeCapability: 'chat',
    localRuntime: {
      endpoint,
      models: [],
      nodeMatrix: [],
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
    connectors: [],
    selectedConnectorId: '',
  };
}
