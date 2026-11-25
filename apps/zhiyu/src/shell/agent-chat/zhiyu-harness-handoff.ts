export interface ZhiyuHandoffBriefPoint {
  readonly id: string;
  readonly text: string;
  readonly selected: boolean;
}

export interface ZhiyuHandoffBriefDraft {
  readonly partnerName: string;
  readonly goal: string;
  readonly points: readonly ZhiyuHandoffBriefPoint[];
  readonly extraNotes: string;
  readonly stayedInZhiyuNotice: string;
}

export interface ZhiyuHandoffSubmitPayload {
  readonly agentHandle: string;
  readonly requestId: string;
  readonly text: string;
  readonly handoffBriefText: string;
}

export type ZhiyuHandoffOutcome =
  | 'ACCEPTED'
  | 'AMBIGUOUS_CANDIDATES'
  | 'DEFERRED_BODY_OFFLINE'
  | 'UNSPECIFIED';

export interface ZhiyuHandoffSubmitResult {
  readonly outcome?: ZhiyuHandoffOutcome;
  readonly resolvedWorkSessionRef: string;
  readonly sessionKind: string;
  readonly ownerBodyKind: string;
  readonly routeReason?: string;
  readonly deduplicated: boolean;
}

export interface ZhiyuHarnessHandoffBridge {
  submit(payload: ZhiyuHandoffSubmitPayload): Promise<ZhiyuHandoffSubmitResult>;
}

const DEFAULT_STAYED_NOTICE = '原始陪伴聊天记录、日常闲聊与情绪上下文保留在织羽。电脑工作台只会收到上方确认的简报。';

function randomRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `zhiyu-handoff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Builds an editable, opt-in handoff brief draft for transferring a concrete work goal from
 * Zhiyu (pure companion) to Nimi Harness (PC work body) without ever dumping raw chat transcripts.
 * @nimi-authority: rule.nimi.zhiyu.local-partner-surface.harness-brief-handoff
 */
export function buildEditableHandoffBriefDraft(input: {
  readonly partnerName: string;
  readonly currentDraft?: string;
  readonly recentTopicHints?: readonly string[];
}): ZhiyuHandoffBriefDraft {
  const goal = (input.currentDraft ?? '').trim().slice(0, 300);
  const points: ZhiyuHandoffBriefPoint[] = [];
  const seen = new Set<string>();
  for (const raw of input.recentTopicHints ?? []) {
    const cleaned = raw.replace(/\s+/gu, ' ').trim().slice(0, 140);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    points.push({
      id: `pt-${points.length + 1}`,
      text: cleaned,
      selected: false,
    });
    if (points.length >= 5) break;
  }
  return {
    partnerName: input.partnerName.trim() || '当前伙伴',
    goal,
    points,
    extraNotes: '',
    stayedInZhiyuNotice: DEFAULT_STAYED_NOTICE,
  };
}

/**
 * Composes the strict controlled payload sent to Runtime RouteAndSubmitInput.
 * Only checked & user-edited fields enter `handoffBriefText`; raw companion transcripts are never included.
 */
export function composeHandoffBriefPayload(input: {
  readonly agentHandle: string;
  readonly goal: string;
  readonly points: readonly ZhiyuHandoffBriefPoint[];
  readonly extraNotes?: string;
  readonly requestId?: string;
}): ZhiyuHandoffSubmitPayload {
  const agentHandle = input.agentHandle.trim();
  if (!agentHandle) {
    throw new Error('请先选择一位本地伙伴后再转交电脑工作台。');
  }
  const goal = input.goal.trim();
  const checkedPoints = input.points
    .filter((pt) => pt.selected && pt.text.trim().length > 0)
    .map((pt) => pt.text.trim());
  const notes = (input.extraNotes ?? '').trim();

  if (!goal && checkedPoints.length === 0 && !notes) {
    throw new Error('请填写要交给电脑工作台办理的目标或至少勾选一条简报要点。');
  }

  const lines: string[] = [];
  if (goal) {
    lines.push(`任务目标：${goal}`);
  }
  if (checkedPoints.length > 0) {
    lines.push('交接要点：');
    for (const point of checkedPoints) {
      lines.push(`- ${point}`);
    }
  }
  if (notes) {
    lines.push(`补充说明：${notes}`);
  }

  const handoffBriefText = lines.join('\n').slice(0, 4000);
  const text = goal || checkedPoints[0] || notes.slice(0, 200);

  return {
    agentHandle,
    requestId: input.requestId?.trim() || randomRequestId(),
    text,
    handoffBriefText,
  };
}

declare global {
  interface Window {
    readonly __nimiZhiyuHarnessHandoff?: ZhiyuHarnessHandoffBridge;
  }
}

export async function submitZhiyuHarnessHandoff(
  payload: ZhiyuHandoffSubmitPayload,
  injectedBridge?: ZhiyuHarnessHandoffBridge,
): Promise<ZhiyuHandoffSubmitResult> {
  const bridge = injectedBridge ?? (typeof window !== 'undefined' ? window.__nimiZhiyuHarnessHandoff : undefined);
  if (!bridge || typeof bridge.submit !== 'function') {
    throw new Error('当前织羽运行环境未连接本机 Harness 转交通道，请先在 Nimi Home 中启动并保持连接。');
  }
  return bridge.submit(payload);
}
