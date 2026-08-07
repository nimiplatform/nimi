import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuRuntimeAgentInventoryStatus = ZhiyuEvidence['inventory'];

export async function probeZhiyuRuntimeAgentInventory(): Promise<ZhiyuRuntimeAgentInventoryStatus> {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return inventoryUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron local-app bridge is not available.',
    });
  }

  // IMP1 deliberately has no App-side Agent inventory carrier. Registration,
  // session availability, and App Access admission are independent facts.
  return inventoryUnavailable({
    reasonCode: 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
    actionHint: 'wait_for_app_access_admission',
    source: 'sdk',
    message: 'Local Agent inventory is unavailable until protected App Access is admitted.',
  });
}

function inventoryUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
}): ZhiyuRuntimeAgentInventoryStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: null,
    count: 0,
    localAgents: [],
  };
}
