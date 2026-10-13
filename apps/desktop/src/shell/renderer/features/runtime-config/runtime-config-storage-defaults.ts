import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

export const RUNTIME_CONFIG_STORAGE_KEY_V16 = 'nimi:runtime-config:v16';

export type StoredStateV11 = {
  version: 16;
  initializedByV11: boolean;
  diagnosticsCollapsed: boolean;
  uiMode: RuntimeConfigStateV11['uiMode'];
  selectedSource: RuntimeConfigStateV11['selectedSource'];
  local: RuntimeConfigStateV11['local'];
};

export function createDefaultStateV11(): RuntimeConfigStateV11 {
  return {
    version: 16,
    initializedByV11: false,
    diagnosticsCollapsed: true,
    uiMode: 'simple',
    selectedSource: 'local',
    local: {
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
    connectors: [],
  };
}
