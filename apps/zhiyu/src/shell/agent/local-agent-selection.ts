import type { ZhiyuRuntimeAgentInventoryStatus } from './agent-inventory';
import type { ZhiyuLocalAgentStatus } from './local-agent-status';

export type ZhiyuRuntimeLocalAgentSelectionInput = {
  readonly inventory: ZhiyuRuntimeAgentInventoryStatus;
  readonly selectedAgentHandle?: string | null;
};

export function resolveZhiyuRuntimeLocalAgentSelection(
  input: ZhiyuRuntimeLocalAgentSelectionInput,
): ZhiyuLocalAgentStatus {
  if (!input.inventory.ready) {
    return localAgentUnavailable({
      reasonCode: input.inventory.reasonCode,
      actionHint: input.inventory.actionHint,
      source: input.inventory.source,
      message: input.inventory.message,
      ownerUserId: input.inventory.ownerUserId,
    });
  }

  const localAgents = input.inventory.localAgents;
  if (input.inventory.count !== localAgents.length) {
    return localAgentUnavailable({
      reasonCode: 'zhiyu-runtime-local-agent-inventory-invalid',
      actionHint: 'refresh_runtime_local_agent_inventory',
      source: input.inventory.source,
      message: 'Runtime LocalAgent inventory count does not match the listed projection.',
      ownerUserId: input.inventory.ownerUserId,
    });
  }
  const selectedAgentHandle = stringOr(input.selectedAgentHandle, '');
  if (selectedAgentHandle) {
    const selected = localAgents.find((agent) => agent.agentHandle === selectedAgentHandle);
    if (selected) {
      return localAgentSelected(selected);
    }
    return localAgentUnavailable({
      reasonCode: 'zhiyu-runtime-local-agent-selection-not-found',
      actionHint: 'refresh_runtime_local_agent_inventory',
      source: input.inventory.source,
      message: 'The selected Runtime LocalAgent is no longer available in the current upstream projection.',
      ownerUserId: input.inventory.ownerUserId,
    });
  }
  if (localAgents.length === 0) {
    return localAgentUnavailable({
      reasonCode: 'zhiyu-runtime-local-agent-inventory-empty',
      actionHint: 'wait_for_account_agent_inventory',
      source: 'runtime',
      message: '账户级授权已生效，但当前没有可用 Agent；后续新增 Agent 会自动出现在织羽中。',
      ownerUserId: input.inventory.ownerUserId,
    });
  }
  if (localAgents.length > 1) {
    return localAgentUnavailable({
      reasonCode: 'zhiyu-runtime-local-agent-selection-required',
      actionHint: 'select_runtime_local_agent',
      source: 'runtime',
      message: 'Runtime inventory has multiple LocalAgents; Zhiyu requires an explicit current selection.',
      ownerUserId: input.inventory.ownerUserId,
    });
  }

  return localAgentSelected(localAgents[0]);
}

function localAgentUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
}): ZhiyuLocalAgentStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    agentHandle: null,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: null,
  };
}

function localAgentSelected(
  agent: ZhiyuRuntimeAgentInventoryStatus['localAgents'][number],
): ZhiyuLocalAgentStatus {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-local-agent-selected',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: '账户授权范围内的 Agent 已通过不透明 handle 选中。',
    agentHandle: agent.agentHandle,
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
