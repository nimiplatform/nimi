import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { createRuntimeAccountMediatedRealmTransport } from '@nimiplatform/sdk/app';
import { Realm, loadNimiRealmWorldIdentityById } from '@nimiplatform/sdk/realm';
import {
  createNimiRuntimeAgentClient,
  Runtime,
  type NimiRuntimeAgentDiscoveredLocalAgent,
} from '@nimiplatform/sdk/runtime';
import { withZhiyuRuntimeAgentBindingRequired } from '../agent-chat/runtime-agent-binding';
import type { ZhiyuEvidence } from '../app/evidence';
import { appId, getRuntimeAccountCaller } from '../auth/runtime-platform';
import {
  hydrateZhiyuInventoryAgentWorldNames,
  type ZhiyuInventoryWorldNameResolver,
} from './agent-inventory-world-name';

export type ZhiyuRuntimeAgentInventoryStatus = ZhiyuEvidence['inventory'];
export type ZhiyuRuntimeAccountStatus = ZhiyuEvidence['auth'];

export async function probeZhiyuRuntimeAgentInventory(
  auth: ZhiyuRuntimeAccountStatus,
): Promise<ZhiyuRuntimeAgentInventoryStatus> {
  if (typeof window !== 'undefined' && window.__nimiZhiyuLocalDevelopment) {
    return inventoryUnavailable({
      reasonCode: 'local-app-agent-inventory-unavailable',
      actionHint: 'request_bounded_local_app_agent_inventory_authority',
      source: 'renderer',
      message: 'The bounded local-app Agent inventory operation is not admitted yet.',
    });
  }
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
    appId,
    transport: { type: 'electron-ipc' },
  });
  const client = createNimiRuntimeAgentClient({
    runtime,
    appId,
    getSubjectUserId: () => auth.accountId || undefined,
    withScopes: withZhiyuRuntimeAgentBindingRequired,
  });

  try {
    const localAgents = await client.listLocalAgents({ ownerUserId: auth.accountId });
    const inventoryAgents = await hydrateZhiyuInventoryAgentWorldNames(
      localAgents.map(toInventoryAgent),
      createZhiyuRuntimeWorldNameResolver(runtime),
    );
    return {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-local-agent-inventory-ready',
      actionHint: 'select_runtime_local_agent',
      source: 'runtime',
      message: 'Runtime LocalAgent inventory was listed through SDK.',
      ownerUserId: auth.accountId,
      count: inventoryAgents.length,
      localAgents: inventoryAgents,
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
    sourceWorldName: agent.sourceWorldName,
    sourceId: agent.sourceId,
    sourceContentHash: agent.sourceContentHash,
    sourceContextStatus: agent.sourceContextStatus,
  };
}

function createZhiyuRuntimeWorldNameResolver(runtime: Runtime): ZhiyuInventoryWorldNameResolver {
  let realm: Realm | null = null;
  return async (worldId) => {
    realm ??= new Realm({
      transport: createRuntimeAccountMediatedRealmTransport({
        runtime,
        accountCaller: getRuntimeAccountCaller(),
      }),
    });
    const identity = await loadNimiRealmWorldIdentityById(
      realm,
      () => {},
      worldId,
      { timeoutMs: 15_000 },
    );
    return identity.name;
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
