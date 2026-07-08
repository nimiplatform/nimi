import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

export const RUNTIME_CONFIG_STORAGE_KEY_V11 = 'nimi:runtime-config:v11';
export const RUNTIME_CONFIG_STORAGE_KEY_V12 = 'nimi:runtime-config:v12';

export type StoredStateV11 = {
  version: 11 | 12;
  initializedByV11: boolean;
  activePage: RuntimeConfigStateV11['activePage'];
  actionFocus?: RuntimeConfigStateV11['actionFocus'];
  diagnosticsCollapsed: boolean;
  uiMode: RuntimeConfigStateV11['uiMode'];
  selectedSource: RuntimeConfigStateV11['selectedSource'];
  activeCapability: RuntimeConfigStateV11['activeCapability'];
  local: RuntimeConfigStateV11['local'];
};

export function createDefaultStateV11(): RuntimeConfigStateV11 {
  return {
    version: 12,
    initializedByV11: false,
    activePage: 'overview',
    actionFocus: null,
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: 'local',
    activeCapability: 'chat',
    local: {
      endpoint: '',
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
