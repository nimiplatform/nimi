import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';

export function currentTurnAssistantText(chat: Pick<ZhiyuEvidence['chat'], 'messages' | 'requestId' | 'runtimeTurnId'>): string | null {
  // The transcript's latest assistant may belong to an earlier turn while the
  // new request is waiting. Only project text correlated with this request.
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.role !== 'agent' && message.role !== 'assistant') continue;
    if (message.kind && message.kind !== 'text' && message.kind !== 'streaming') continue;
    const runtimeTurnId = message.metadata?.runtimeTurnId ?? message.metadata?.runtime_turn_id;
    const matches = runtimeTurnId && chat.runtimeTurnId
      ? runtimeTurnId === chat.runtimeTurnId
      : Boolean(chat.requestId && message.metadata?.turnId === chat.requestId);
    if (matches && message.text.trim()) return message.text;
  }
  return null;
}

export function chatReplyChipLabel(evidence: ZhiyuEvidence): string {
  if (evidence.chat.state === 'media-pending') return '文字已完成';
  if (evidence.chat.ready) {
    return '已就绪';
  }
  if (evidence.chat.state === 'streaming') {
    return '回复中';
  }
  if (evidence.chat.state === 'failed') {
    return '需要处理';
  }
  return '等待开始';
}

export function chatBlockedHint(evidence: ZhiyuEvidence): string {
  if (!evidence.localAgent.ready) {
    if (evidence.inventory.localAgents.length === 0) {
      return '添加本地伙伴后开始聊天。';
    }
    return '请先选择已存在的本地伙伴。';
  }
  if (!evidence.conversation.ready) {
    return conversationReadinessHint(evidence.conversation);
  }
  if (!evidence.turn.ready) {
    if (evidence.turn.reasonCode.includes('ACCESS_UNAVAILABLE')) {
      return '当前应用暂时没有发送消息的权限。';
    }
    if (evidence.turn.reasonCode === 'zhiyu-agent-handle-not-covered') {
      return '当前伙伴已不在本地伙伴列表中，请刷新伙伴列表。';
    }
    return '当前会话暂时不能发送，请刷新伙伴或重新打开会话。';
  }
  return '当前暂时不能发送，请稍后重试。';
}

function conversationReadinessHint(conversation: ZhiyuEvidence['conversation']): string {
  const reasonCode = conversation.reasonCode?.trim() || '';
  if (!reasonCode || reasonCode === 'not-probed') {
    return '正在打开会话，请稍候。';
  }
  if (reasonCode === 'zhiyu-local-agent-required') {
    return '请先选择已存在的本地伙伴。';
  }
  if (reasonCode === 'electron-runtime-bridge-unavailable') {
    return '本地连接暂时不可用，请重启织羽。';
  }
  if (
    reasonCode.includes('anchor')
    || reasonCode.includes('conversation')
    || reasonCode.includes('unavailable')
    || reasonCode.includes('missing')
  ) {
    return '会话没有打开成功，请重新选择伙伴或重启织羽后再试。';
  }
  return '会话暂时不可用，请稍后重试。';
}

export function currentPartnerDisplayName(evidence: ZhiyuEvidence): string {
  const selectedHandle = evidence.localAgent.agentHandle;
  const fromInventory = evidence.inventory.localAgents.find((agent) => agent.agentHandle === selectedHandle);
  const displayName = normalizedPartnerName(fromInventory?.displayName);
  if (displayName) {
    return displayName;
  }
  if (evidence.localAgent.ready) {
    return '当前伙伴';
  }
  return '本地伙伴';
}

export function currentPartnerAvatarUrl(evidence: ZhiyuEvidence): string | null {
  const selectedHandle = evidence.localAgent?.agentHandle;
  return evidence.inventory?.localAgents.find((agent) => agent.agentHandle === selectedHandle)?.avatarUrl ?? null;
}

export function currentPartnerSubtitle(evidence: ZhiyuEvidence): string {
  void evidence;
  return '本地伙伴';
}

export function agentCenterWorldLabel(evidence: ZhiyuEvidence): string | null {
  void evidence;
  return null;
}

function normalizedPartnerName(value: string | null | undefined): string | null {
  const displayName = value?.trim();
  if (!displayName) {
    return null;
  }
  if (isTechnicalPartnerDisplayName(displayName)) {
    return null;
  }
  return displayName;
}

function isTechnicalPartnerDisplayName(value: string): boolean {
  return /\b(?:Runtime|SDK|LocalAgent|sourceRef|not_projected)\b/i.test(value);
}

const STATE_DISPLAY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  projected: '已同步',
  idle: '空闲',
  completed: '已完成',
  streaming: '回复中',
  blocked: '受阻',
  focused: '专注',
  chat_active: '对话中',
  active: '活跃',
  calm: '平静',
  neutral: '平和',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
  waiting: '等待中',
  sleeping: '休眠中',
  paused: '已暂停',
  starting: '启动中',
  stopping: '停止中',
  stopped: '已停止',
  suspended: '已挂起',
  offline: '离线',
  inactive: '未激活',
  error: '异常',
  failed: '异常',
  happy: '开心',
  sad: '难过',
  angry: '愤怒',
  anxious: '焦虑',
  confused: '困惑',
  curious: '好奇',
  excited: '兴奋',
  tired: '疲惫',
});

export function stateDisplayLabel(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized === 'not_projected') {
    return '暂无数据';
  }
  const key = normalized.toLowerCase().replaceAll('-', '_');
  return STATE_DISPLAY_LABELS[key] ?? normalized;
}

export function agentCenterHeaderStateLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  const normalizedState = normalized.toLowerCase().replaceAll('-', '_');
  if (
    normalizedState === 'not_projected'
    || normalizedState.startsWith('not_projected_')
    || normalizedState === 'not_configured'
    || normalizedState === 'not_selected'
    || normalizedState === 'unknown'
    || normalizedState === 'ready'
  ) {
    return null;
  }
  return stateDisplayLabel(normalized);
}

export function avatarStatusMessage(action: ZhiyuAvatarLaunchAction): string {
  if (action.state === 'ready') {
    return '可以从输入区启动形象。';
  }
  if (action.state === 'blocked') {
    return '请先在伙伴中心完成形象设置。';
  }
  return '伙伴形象尚未设置完成。';
}

export function partnerInitial(value: string | null | undefined): string {
  const displayName = normalizedPartnerName(value);
  if (!displayName) {
    return '本';
  }
  const firstLetter = displayName.match(/[A-Za-z]/)?.[0];
  if (firstLetter) {
    return firstLetter.toUpperCase();
  }
  return Array.from(displayName)[0] || '本';
}

export function conversationMessagesForDisplay(
  messages: ZhiyuEvidence['chat']['messages'],
  currentPartnerName: string,
): ZhiyuEvidence['chat']['messages'] {
  return messages
    .filter((message) => !isEmptyStreamingTranscriptPlaceholder(message))
    .map((message) => ({
      ...message,
      senderName: transcriptSenderName(message.senderName, currentPartnerName),
      text: message.text,
    }));
}

function isEmptyStreamingTranscriptPlaceholder(message: ZhiyuEvidence['chat']['messages'][number]): boolean {
  const streaming = message.kind === 'streaming' || message.status === 'streaming' || message.status === 'pending';
  return streaming && runtimeTextForDisplay(message.text).length === 0;
}

function transcriptSenderName(value: string | null | undefined, currentPartnerName: string): string | null | undefined {
  if (value === 'You') return '你';
  if (value === 'Zhiyu Agent') return currentPartnerName;
  return value;
}

function runtimeTextForDisplay(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  return text;
}

export function formatZhiyuTranscriptDateLabel({ date, diffDays }: { readonly date: Date; readonly diffDays: number }): string {
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date);
}
