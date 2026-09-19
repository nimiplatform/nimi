import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

export const RUNTIME_CONFIG_STORAGE_KEY_V15 = 'nimi:runtime-config:v15';

export type StoredStateV11 = {
  version: 15;
  initializedByV11: boolean;
  activePage: RuntimeConfigStateV11['activePage'];
  actionFocus?: RuntimeConfigStateV11['actionFocus'];
  diagnosticsCollapsed: boolean;
  uiMode: RuntimeConfigStateV11['uiMode'];
  selectedSource: RuntimeConfigStateV11['selectedSource'];
  local: RuntimeConfigStateV11['local'];
};

export function createDefaultStateV11(): RuntimeConfigStateV11 {
  return {
    version: 15,
    initializedByV11: false,
    activePage: 'aiSettings',
    actionFocus: null,
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: 'local',
    local: {
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
    connectors: [],
    selectedConnectorId: '',
  };
}
