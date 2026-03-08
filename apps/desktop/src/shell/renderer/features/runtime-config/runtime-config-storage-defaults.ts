import { DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11, type RuntimeConfigStateV11 } from './runtime-config-state-types';

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
  activePage: RuntimeConfigStateV11['activePage'];
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
    activePage: 'overview',
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
