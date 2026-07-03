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
      actionHint: 'open_desktop_explore_character_persona',
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

  return localAgentUnavailable({
    reasonCode: 'zhiyu-realm-materialized-partner-required',
    actionHint: 'open_desktop_explore_character_persona',
    source: 'runtime',
    message: 'Zhiyu requires a Runtime-owned partner selected from Desktop Explore character/persona context before opening chat.',
    ownerUserId: input.inventory.ownerUserId,
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
