import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ZhiyuEvidence } from '../app/evidence';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';

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

  try {
    const localAgents = await getZhiyuLocalAppClient().agents.listReferences();
    return {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-agent-references-ready',
      actionHint: localAgents.length > 0 ? 'select_runtime_local_agent' : 'open_desktop_agent_center',
      source: 'runtime',
      message: 'Current-account active Agents are projected through session-scoped handles.',
      ownerUserId: null,
      count: localAgents.length,
      localAgents,
    };
  } catch (error) {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    return inventoryUnavailable({
      reasonCode: text(record.reasonCode) || 'zhiyu-agent-reference-list-unavailable',
      actionHint: text(record.actionHint) || 'retry_agent_reference_list',
      source: text(record.source) || 'sdk',
      message: error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Runtime Agent references are unavailable.',
    });
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
