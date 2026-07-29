import {
  openDesktopIntent,
  type NimiDesktopOpenRendererRequest,
  type NimiDesktopOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiDesktopOpenIntent } from '@nimiplatform/kit/core/desktop-open';

export const ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION = 'desktop_open_select_partner' as const;
export const ZHIYU_DESKTOP_OPEN_AGENT_CONFIG_ACTION = 'desktop_open_agent_config' as const;

export const ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_REQUEST = {
  intent: zhiyuDesktopOpenIntentForProductGap({
    stage: 'agent-required',
    actionHint: ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION,
  }) ?? {
    kind: 'open-explore',
    section: 'personas',
    productIntent: 'select-partner',
  },
} satisfies NimiDesktopOpenRendererRequest;

export const ZHIYU_DESKTOP_OPEN_AGENT_CONFIG_REQUEST = {
  intent: {
    kind: 'open-agents',
    view: 'inventory',
  },
} satisfies NimiDesktopOpenRendererRequest;

export type ZhiyuDesktopOpenProductGapInput = {
  readonly stage?: string | null;
  readonly reasonCode?: string | null;
  readonly actionHint?: string | null;
  readonly capabilityReasonCode?: string | null;
};

export type ZhiyuDesktopOpenActionResult = {
  readonly state: 'accepted' | 'rejected' | 'failed';
  readonly actionId: typeof ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly message: string;
};

export type ZhiyuDesktopOpenIntentInvoker = (
  request: NimiDesktopOpenRendererRequest,
) => Promise<NimiDesktopOpenResult>;

export function zhiyuDesktopOpenIntentForProductGap(
  input: ZhiyuDesktopOpenProductGapInput,
): NimiDesktopOpenIntent | null {
  const stage = normalizeText(input.stage);
  const reasonCode = normalizeText(input.reasonCode);
  const actionHint = normalizeText(input.actionHint);
  const capabilityReasonCode = normalizeText(input.capabilityReasonCode);
  if (
    actionHint === ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION
      || stage === 'source-required'
      || stage === 'agent-required'
      || reasonCode.includes('local-agent')
  ) {
    return {
      kind: 'open-explore',
      section: 'personas',
      productIntent: 'select-partner',
    };
  }
  if (capabilityReasonCode === 'connector_missing' || reasonCode === 'connector_missing') {
    return {
      kind: 'open-runtime-config',
      page: 'cloud',
      action: 'add-connector',
    };
  }
  if (
    stage === 'route-required'
      || reasonCode === 'model_missing'
      || reasonCode === 'zhiyu-agent-ai-config-not-configured'
      || capabilityReasonCode === 'model_missing'
  ) {
    return {
      kind: 'open-runtime-config',
      page: 'models',
      action: 'install-model',
    };
  }
  return null;
}

export async function requestZhiyuDesktopOpenAgentConfig(
  invokeDesktopOpenIntent: ZhiyuDesktopOpenIntentInvoker = openDesktopIntent,
): Promise<NimiDesktopOpenResult> {
  return invokeDesktopOpenIntent(ZHIYU_DESKTOP_OPEN_AGENT_CONFIG_REQUEST);
}

export async function requestZhiyuDesktopOpenSelectPartner(
  invokeDesktopOpenIntent: ZhiyuDesktopOpenIntentInvoker = openDesktopIntent,
): Promise<ZhiyuDesktopOpenActionResult> {
  try {
    const result = await invokeDesktopOpenIntent(ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_REQUEST);
    if (result.status === 'accepted') {
      return {
        state: 'accepted',
        actionId: ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION,
        reasonCode: 'desktop-open-accepted',
        actionHint: 'wait_for_desktop_explore',
        message: 'Nimi 桌面端已接收请求，请在「探索」中选择伙伴。',
      };
    }
    return projectRejectedDesktopOpenResult(result);
  } catch (error) {
    return projectDesktopOpenFailure(error);
  }
}

function projectRejectedDesktopOpenResult(
  result: Extract<NimiDesktopOpenResult, { readonly status: 'rejected' }>,
): ZhiyuDesktopOpenActionResult {
  return {
    state: 'rejected',
    actionId: ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION,
    reasonCode: result.reasonCode,
    actionHint: result.actionHint,
    message: desktopOpenReasonCopy(result.reasonCode),
  };
}

function projectDesktopOpenFailure(error: unknown): ZhiyuDesktopOpenActionResult {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonCode = normalizeText(record.reasonCode) || 'desktop-open-host-unavailable';
  const actionHint = normalizeText(record.actionHint) || 'check_desktop_runtime_bridge';
  return {
    state: 'failed',
    actionId: ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION,
    reasonCode,
    actionHint,
    message: desktopOpenReasonCopy(reasonCode),
  };
}

function desktopOpenReasonCopy(reasonCode: string): string {
  switch (reasonCode) {
    case 'desktop-open-desktop-not-running':
      return '请先打开 Nimi 桌面端；织羽不会代替你启动桌面端。';
    case 'desktop-open-desktop-not-ready':
      return 'Nimi 桌面端正在加载，请稍后重试。';
    case 'desktop-open-host-unavailable':
    case 'renderer-standard-shell-host-unavailable':
      return '当前环境无法自动打开 Nimi 桌面端。请手动打开桌面端「探索」页，继续选择伙伴来源。';
    case 'desktop-open-bridge-auth-failed':
      return 'Nimi 桌面端连接校验失败，请重启桌面端后重试。';
    case 'desktop-open-intent-invalid':
    case 'desktop-open-target-unsupported':
      return '当前环境不支持自动打开目标页面。请手动前往 Nimi 桌面端「探索」页。';
    default:
      return '暂时无法自动打开 Nimi 桌面端。请手动前往桌面端「探索」页。';
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
