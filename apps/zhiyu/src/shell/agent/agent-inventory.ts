import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ZhiyuEvidence } from '../app/evidence';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';

export type ZhiyuRuntimeAgentInventoryStatus = ZhiyuEvidence['inventory'];

export const ZHIYU_AGENTS_INTERACT_REASON = '与您账户中当前及未来的全部 Agent 开始和继续对话。';

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
    const permission = await getZhiyuLocalAppClient().permissions.status('agents.interact');
    if (permission.posture !== 'granted') {
      return inventoryForPermissionPosture(permission.posture, permission.canRequest, permission.detail);
    }
    const localAgents = permission.agents.map((agent) => ({
      agentHandle: agent.agentHandle,
      displayName: agent.displayName,
      sourceReady: true,
    }));
    return {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-local-agent-grant-projection-ready',
      actionHint: localAgents.length > 0 ? 'select_runtime_local_agent' : 'wait_for_account_agent_inventory',
      source: 'runtime',
      message: localAgents.length > 0
        ? '账户授权范围内当前可用的 Agent 已通过 SDK localApp 投影加载。'
        : '账户级 Agent 授权已生效；当前没有可用 Agent，后续新增 Agent 将自动纳入。',
      ownerUserId: null,
      count: localAgents.length,
      localAgents,
    };
  } catch (error) {
    return normalizeInventoryError(error);
  }
}

export async function requestZhiyuAgentInteractionPermission(): Promise<ZhiyuRuntimeAgentInventoryStatus> {
  try {
    await getZhiyuLocalAppClient().permissions.request({
      permissionId: 'agents.interact',
      reason: ZHIYU_AGENTS_INTERACT_REASON,
    });
    return probeZhiyuRuntimeAgentInventory();
  } catch (error) {
    return normalizeInventoryError(error);
  }
}

function inventoryForPermissionPosture(
  posture: string,
  canRequest: boolean,
  detail?: string,
): ZhiyuRuntimeAgentInventoryStatus {
  const postureProjection: Record<string, { readonly reasonCode: string; readonly actionHint: string; readonly message: string }> = {
    prompt: {
      reasonCode: 'zhiyu-agents-interact-permission-prompt',
      actionHint: 'request_agents_interact_permission',
      message: '请求一次账户级授权后，织羽可与您当前及未来的全部 Agent 交互。',
    },
    pending: {
      reasonCode: 'zhiyu-agents-interact-permission-pending',
      actionHint: 'wait_for_agents_interact_permission_decision',
      message: '账户级 Agent 交互授权请求正在等待您在 Nimi 桌面端处理。',
    },
    unavailable: {
      reasonCode: 'zhiyu-agents-interact-capability-unavailable',
      actionHint: 'check_agents_interact_admission',
      message: 'Agent 交互能力当前不可用。',
    },
  };
  const selected = postureProjection[posture] ?? postureProjection.unavailable!;
  return inventoryUnavailable({
    ...selected,
    actionHint: canRequest ? 'request_agents_interact_permission' : selected.actionHint,
    message: detail ? `${selected.message} (${detail})` : selected.message,
    source: 'runtime',
  });
}

function normalizeInventoryError(error: unknown): ZhiyuRuntimeAgentInventoryStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return inventoryUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-runtime-agent-inventory-failed'),
    actionHint: stringOr(record.actionHint, 'check_agents_interact_permission'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Granted Agent projection failed.',
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

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
