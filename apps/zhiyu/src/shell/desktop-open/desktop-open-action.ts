import {
  openDesktopIntent,
  type NimiDesktopOpenRendererRequest,
  type NimiDesktopOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiDesktopOpenIntent } from '@nimiplatform/kit/core/desktop-open';

export const ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION = 'desktop_open_select_partner' as const;

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
        message: 'Desktop Explore 已接收请求，请在 Desktop 中选择伙伴。',
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
  const detail = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Desktop Open standard shell operation failed.';
  return {
    state: 'failed',
    actionId: ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION,
    reasonCode,
    actionHint,
    message: `${desktopOpenReasonCopy(reasonCode)} ${detail}`,
  };
}

function desktopOpenReasonCopy(reasonCode: string): string {
  switch (reasonCode) {
    case 'desktop-open-desktop-not-running':
      return '请先打开 Nimi Desktop；织羽不会尝试冷启动 Desktop。';
    case 'desktop-open-desktop-not-ready':
      return 'Nimi Desktop 正在加载，请稍后重试。';
    case 'desktop-open-host-unavailable':
    case 'renderer-standard-shell-host-unavailable':
      return '当前应用宿主不能从这个环境联系 Nimi Desktop。';
    case 'desktop-open-bridge-auth-failed':
      return 'Desktop Open 本地桥接认证失败，请重启 Desktop 后重试。';
    case 'desktop-open-intent-invalid':
    case 'desktop-open-target-unsupported':
      return 'Desktop Open 请求不符合当前标准。';
    default:
      return 'Desktop Open 请求未完成。';
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
