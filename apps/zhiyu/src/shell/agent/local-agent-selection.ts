import type { ZhiyuRuntimeAgentInventoryStatus } from './agent-inventory';
import type { ZhiyuLocalAgentStatus } from './local-agent-discovery';

export type ZhiyuRuntimeLocalAgentSelectionInput = {
  readonly inventory: ZhiyuRuntimeAgentInventoryStatus;
  readonly selectedLocalAgentRef?: string | null;
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
  const selectedLocalAgentRef = stringOr(input.selectedLocalAgentRef, '');
  if (selectedLocalAgentRef) {
    const selected = localAgents.find((agent) => agent.localAgentRef === selectedLocalAgentRef);
    if (selected?.sourceReady === true) {
      return localAgentSelected(selected);
    }
    if (selected) {
      return localAgentUnavailable({
        reasonCode: 'zhiyu-runtime-local-agent-source-not-ready',
        actionHint: 'desktop_open_select_partner',
        source: 'runtime',
        message: 'The selected Runtime LocalAgent source snapshot is not ready. Continue source selection in Desktop Explore, then refresh the Runtime inventory.',
        ownerUserId: selected.ownerUserId,
        runtimeSourceRef: selected.runtimeSourceRef,
      });
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
      actionHint: 'desktop_open_select_partner',
      source: 'runtime',
      message: 'Runtime inventory has no active Runtime-owned partner for Zhiyu to open. Use Desktop Explore character/persona context and return after Runtime reports an available partner.',
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

  const only = localAgents[0];
  if (only?.sourceReady === true) {
    return localAgentSelected(only);
  }
  return localAgentUnavailable({
    reasonCode: 'zhiyu-runtime-local-agent-source-not-ready',
    actionHint: 'desktop_open_select_partner',
    source: 'runtime',
    message: 'The Runtime LocalAgent source snapshot is not ready. Continue source selection in Desktop Explore, then refresh the Runtime inventory.',
    ownerUserId: only?.ownerUserId ?? input.inventory.ownerUserId,
    runtimeSourceRef: only?.runtimeSourceRef ?? null,
  });
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

function localAgentSelected(
  agent: ZhiyuRuntimeAgentInventoryStatus['localAgents'][number],
): ZhiyuLocalAgentStatus {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-local-agent-selected',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was selected from the upstream inventory projection.',
    ownerUserId: agent.ownerUserId,
    runtimeSourceRef: agent.runtimeSourceRef,
    localAgentRef: agent.localAgentRef,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
