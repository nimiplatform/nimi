import type { ZhiyuRuntimeAgentInventoryStatus } from './agent-inventory';
import type { ZhiyuLocalAgentStatus } from './local-agent-discovery';

export type ZhiyuRuntimeLocalAgentSelectionInput = {
  readonly sourceLocalAgent: ZhiyuLocalAgentStatus;
  readonly inventory: ZhiyuRuntimeAgentInventoryStatus;
};

export function resolveZhiyuRuntimeLocalAgentSelection(
  input: ZhiyuRuntimeLocalAgentSelectionInput,
): ZhiyuLocalAgentStatus {
  if (input.sourceLocalAgent.ready) {
    return input.sourceLocalAgent;
  }
  if (!input.inventory.ready) {
    return input.sourceLocalAgent;
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
  if (localAgents.length === 0) {
    return localAgentUnavailable({
      reasonCode: 'zhiyu-runtime-local-agent-inventory-empty',
      actionHint: 'materialize_runtime_owned_local_agent',
      source: 'runtime',
      message: 'Runtime inventory has no active LocalAgent for Zhiyu to open.',
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

  const agent = localAgents[0];
  const ownerUserId = stringOr(agent.ownerUserId, '');
  const runtimeSourceRef = stringOr(agent.runtimeSourceRef, '');
  const localAgentRef = stringOr(agent.localAgentRef, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return localAgentUnavailable({
      reasonCode: 'zhiyu-runtime-local-agent-inventory-invalid',
      actionHint: 'refresh_runtime_local_agent_inventory',
      source: 'runtime',
      message: 'Runtime LocalAgent inventory returned an incomplete opaque identity projection.',
      ownerUserId: input.inventory.ownerUserId,
    });
  }

  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-local-agent-selected-from-inventory',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was selected from the single-agent inventory projection.',
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
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
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
