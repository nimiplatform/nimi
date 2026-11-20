import {
  openDesktopIntent,
  type NimiDesktopOpenRendererRequest,
  type NimiDesktopOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiUtopiaResident } from '@nimiplatform/sdk/app';

export type UtopiaDesktopOpenInvoker = (
  request: NimiDesktopOpenRendererRequest,
) => Promise<NimiDesktopOpenResult>;

export type UtopiaDesktopOpenOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reasonCode: string; message: string }>;

const MAX_DESKTOP_OPEN_QUERY_LENGTH = 160;
export const MAX_UTOPIA_ZHIYU_DRAFT_CHARS = 8000;
const ANCHOR_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;

function truncateDesktopQuery(raw?: string | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const chars = Array.from(trimmed);
  return chars.length <= MAX_DESKTOP_OPEN_QUERY_LENGTH
    ? trimmed
    : chars.slice(0, MAX_DESKTOP_OPEN_QUERY_LENGTH).join('');
}

function validateConversationDraft(
  raw?: string | null,
): { readonly ok: true; readonly text: string | undefined } | { readonly ok: false; readonly reasonCode: string; readonly message: string } {
  if (typeof raw !== 'string') {
    return { ok: true, text: undefined };
  }
  if (raw.includes('\0')) {
    return {
      ok: false,
      reasonCode: 'draft-invalid-character',
      message: '门前便签包含不支持的控制字符，草稿已保留，请整理后再转至织羽。',
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, text: undefined };
  }
  const charCount = Array.from(trimmed).length;
  if (charCount > MAX_UTOPIA_ZHIYU_DRAFT_CHARS) {
    return {
      ok: false,
      reasonCode: 'draft-too-long',
      message: `门前便签已达 ${charCount} 字，超过织羽交接上限（${MAX_UTOPIA_ZHIYU_DRAFT_CHARS} 字），未截断或发送，请精简后再交接。`,
    };
  }
  return { ok: true, text: trimmed };
}

function describeDesktopOpenRejection(reasonCode: string, target: 'home' | 'zhiyu'): string {
  if (target === 'zhiyu') {
    switch (reasonCode) {
      case 'desktop-open-desktop-not-running':
        return '请先启动 Nimi Home 才能唤起织羽继续深聊，门前草稿已保留。';
      case 'desktop-open-desktop-not-ready':
        return '织羽暂时未能打开该伙伴会话，门前草稿已为你保留，请稍后重试。';
      case 'desktop-open-bridge-auth-failed':
        return 'Nimi Home 连接校验未通过，门前草稿已保留，请重新打开 Nimi Home 后重试。';
      case 'desktop-open-intent-invalid':
      case 'desktop-open-target-unsupported':
        return '当前 Nimi Home 版本不支持直接转至织羽，请手动在织羽中打开该伙伴。';
      case 'desktop-open-host-unavailable':
      case 'renderer-standard-shell-host-unavailable':
      default:
        return '当前环境无法自动唤起织羽，门前草稿已保留，请手动打开织羽交流。';
    }
  }
  switch (reasonCode) {
    case 'desktop-open-desktop-not-running':
      return '请先启动 Nimi Home，再前往「我的伙伴」查看或管理伙伴。';
    case 'desktop-open-desktop-not-ready':
      return 'Nimi Home 正在准备中，请稍后重试。';
    case 'desktop-open-bridge-auth-failed':
      return 'Nimi Home 连接校验未通过，请重新打开 Nimi Home 后重试。';
    case 'desktop-open-intent-invalid':
    case 'desktop-open-target-unsupported':
      return '当前 Nimi Home 版本不支持自动打开该页面，请手动前往「我的伙伴」。';
    case 'desktop-open-host-unavailable':
    case 'renderer-standard-shell-host-unavailable':
    default:
      return '当前环境无法自动唤起 Nimi Home，请手动在 Nimi Home 中打开「我的伙伴」。';
  }
}

async function runDesktopOpenRequest(
  request: NimiDesktopOpenRendererRequest,
  invoke: UtopiaDesktopOpenInvoker,
  target: 'home' | 'zhiyu' = 'home',
): Promise<UtopiaDesktopOpenOutcome> {
  try {
    const result = await invoke(request);
    if (result.status === 'accepted') {
      return Object.freeze({ ok: true });
    }
    return Object.freeze({
      ok: false,
      reasonCode: result.reasonCode,
      message: describeDesktopOpenRejection(result.reasonCode, target),
    });
  } catch (error) {
    const rawCode = error && typeof error === 'object' && 'reasonCode' in error
      ? String((error as { reasonCode?: unknown }).reasonCode ?? '').trim()
      : '';
    const reasonCode = rawCode || 'desktop-open-host-unavailable';
    return Object.freeze({
      ok: false,
      reasonCode,
      message: describeDesktopOpenRejection(reasonCode, target),
    });
  }
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-dopen-003
export async function openHomePartnersFromUtopia(
  query?: string | null,
  invoke: UtopiaDesktopOpenInvoker = openDesktopIntent,
): Promise<UtopiaDesktopOpenOutcome> {
  const safeQuery = truncateDesktopQuery(query);
  return runDesktopOpenRequest(
    {
      intent: {
        kind: 'open-partners',
        ...(safeQuery ? { query: safeQuery } : {}),
      },
    },
    invoke,
    'home',
  );
}

export async function openHomePartnerManagementFromUtopia(
  input: {
    readonly conversationAnchorId?: string | null;
    readonly displayName?: string | null;
  },
  invoke: UtopiaDesktopOpenInvoker = openDesktopIntent,
): Promise<UtopiaDesktopOpenOutcome> {
  const anchor = typeof input.conversationAnchorId === 'string'
    ? input.conversationAnchorId.trim()
    : '';
  if (anchor && ANCHOR_PATTERN.test(anchor)) {
    return runDesktopOpenRequest(
      {
        intent: {
          kind: 'open-agent-center',
          conversationAnchorId: anchor,
        },
      },
      invoke,
      'home',
    );
  }
  return openHomePartnersFromUtopia(input.displayName, invoke);
}

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.conversation-open
export async function openPartnerConversationInZhiyuFromUtopia(
  input: {
    readonly agentHandle: NimiUtopiaResident['agentHandle'];
    readonly mountedAnchorId?: string | null;
    readonly draftText?: string | null;
    readonly openConversation: (req: {
      readonly agentHandle: NimiUtopiaResident['agentHandle'];
    }) => Promise<{ readonly conversationAnchorId: string }>;
  },
  invoke: UtopiaDesktopOpenInvoker = openDesktopIntent,
): Promise<UtopiaDesktopOpenOutcome> {
  const validatedDraft = validateConversationDraft(input.draftText);
  if (!validatedDraft.ok) {
    return Object.freeze({
      ok: false,
      reasonCode: validatedDraft.reasonCode,
      message: validatedDraft.message,
    });
  }
  let anchor = typeof input.mountedAnchorId === 'string'
    ? input.mountedAnchorId.trim()
    : '';
  if (!anchor || !ANCHOR_PATTERN.test(anchor)) {
    try {
      const opened = await input.openConversation({ agentHandle: input.agentHandle });
      anchor = typeof opened?.conversationAnchorId === 'string'
        ? opened.conversationAnchorId.trim()
        : '';
    } catch {
      return Object.freeze({
        ok: false,
        reasonCode: 'conversation-anchor-unavailable',
        message: '暂时无法找到这位伙伴的会话，门前草稿已保留，请确认已在 Nimi Home 登录。',
      });
    }
  }
  if (!anchor || !ANCHOR_PATTERN.test(anchor)) {
    return Object.freeze({
      ok: false,
      reasonCode: 'conversation-anchor-unavailable',
      message: '暂时无法找到这位伙伴的会话，门前草稿已保留，请确认已在 Nimi Home 登录。',
    });
  }
  return runDesktopOpenRequest(
    {
      intent: {
        kind: 'open-partner-conversation',
        conversationAnchorId: anchor,
        ...(validatedDraft.text ? { text: validatedDraft.text } : {}),
      },
    },
    invoke,
    'zhiyu',
  );
}
