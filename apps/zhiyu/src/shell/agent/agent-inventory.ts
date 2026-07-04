import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createNimiRuntimeAgentClient,
  Runtime,
  type NimiRuntimeAgentDiscoveredLocalAgent,
} from '@nimiplatform/sdk/runtime';
import { withZhiyuRuntimeAgentBindingRequired } from '../agent-chat/runtime-agent-binding';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuRuntimeAgentInventoryStatus = ZhiyuEvidence['inventory'];
export type ZhiyuRuntimeAccountStatus = ZhiyuEvidence['auth'];

export async function probeZhiyuRuntimeAgentInventory(
  auth: ZhiyuRuntimeAccountStatus,
): Promise<ZhiyuRuntimeAgentInventoryStatus> {
  if (!auth.ready || !auth.accountId) {
    return inventoryUnavailable({
      reasonCode: 'zhiyu-runtime-account-required',
      actionHint: 'authenticate_runtime_account',
      source: 'renderer',
      message: 'Zhiyu requires a Runtime account projection before listing LocalAgents.',
    });
  }
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return inventoryUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
      ownerUserId: auth.accountId,
    });
  }

  const runtime = new Runtime({
    appId: 'nimi.zhiyu',
    transport: { type: 'electron-ipc' },
  });
  const client = createNimiRuntimeAgentClient({
    runtime,
    appId: 'nimi.zhiyu',
    getSubjectUserId: () => auth.accountId || undefined,
    withScopes: withZhiyuRuntimeAgentBindingRequired,
  });

  try {
    const localAgents = await client.listLocalAgents({ ownerUserId: auth.accountId });
    return {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-local-agent-inventory-ready',
      actionHint: 'select_runtime_local_agent',
      source: 'runtime',
      message: 'Runtime LocalAgent inventory was listed through SDK.',
      ownerUserId: auth.accountId,
      count: localAgents.length,
      localAgents: localAgents.map(toInventoryAgent),
    };
  } catch (error) {
    return normalizeInventoryError(error, auth.accountId);
  }
}

function toInventoryAgent(agent: NimiRuntimeAgentDiscoveredLocalAgent): ZhiyuRuntimeAgentInventoryStatus['localAgents'][number] {
  return {
    localAgentRef: agent.localAgentRef,
    ownerUserId: agent.ownerUserId,
    runtimeSourceRef: agent.runtimeSourceRef,
    displayName: agent.displayName,
    sourceKind: agent.sourceKind,
    sourceWorldId: agent.sourceWorldId,
    sourceId: agent.sourceId,
    sourceContentHash: agent.sourceContentHash,
  };
}

function normalizeInventoryError(error: unknown, ownerUserId: string): ZhiyuRuntimeAgentInventoryStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return inventoryUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-runtime-agent-inventory-failed'),
    actionHint: stringOr(record.actionHint, 'check_runtime_agent_inventory'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Runtime LocalAgent inventory listing failed.',
    ownerUserId,
  });
}

function inventoryUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
}): ZhiyuRuntimeAgentInventoryStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    count: 0,
    localAgents: [],
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
