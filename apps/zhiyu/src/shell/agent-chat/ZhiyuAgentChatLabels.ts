import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';

export function chatPrimaryBindingLabel(evidence: ZhiyuEvidence): string {
  const binding = evidence.route.executionBinding;
  if (!binding) {
    return '未绑定模型';
  }
  if (binding.route === 'local') {
    return '本地对话模型已绑定';
  }
  return '模型已绑定';
}

export function chatReplyChipLabel(evidence: ZhiyuEvidence): string {
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
    return '请先选择已存在的本地伙伴。';
  }
  if (!evidence.conversation.ready) {
    return '正在打开会话，请稍候。';
  }
  if (!evidence.route.executionBinding) {
    return '请先完成模型配置后再发送。';
  }
  return '当前暂时不能发送，请稍后重试。';
}

export function currentPartnerDisplayName(evidence: ZhiyuEvidence): string {
  const selectedRef = evidence.localAgent.localAgentRef;
  const fromInventory = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === selectedRef);
  const displayName = normalizedPartnerName(fromInventory?.displayName);
  if (displayName) {
    return displayName;
  }
  if (evidence.localAgent.ready) {
    return '当前伙伴';
  }
  return '本地伙伴';
}

export function currentPartnerSubtitle(evidence: ZhiyuEvidence): string {
  const selectedRef = evidence.localAgent.localAgentRef;
  const fromInventory = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === selectedRef);
  if (fromInventory?.sourceKind === 'worldCharacter') {
    return '世界角色';
  }
  return '本地伙伴';
}

export function agentCenterLocalAgentRef(evidence: ZhiyuEvidence): string | null {
  if (!evidence.localAgent.ready) {
    return null;
  }
  return evidence.localAgent.localAgentRef || evidence.conversation.localAgentRef || null;
}

export function agentCenterWorldLabel(evidence: ZhiyuEvidence): string | null {
  const selectedRef = evidence.localAgent.localAgentRef;
  const fromInventory = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === selectedRef);
  if (fromInventory?.sourceKind !== 'worldCharacter') {
    return null;
  }
  return '世界角色';
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
  return /\b(?:Runtime|SDK|LocalAgent|sourceRef|localAgentRef|not_projected)\b/i.test(value);
}

export function stateDisplayLabel(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized === 'not_projected') {
    return '未投影';
  }
  if (normalized === 'projected') {
    return '已投影';
  }
  if (normalized === 'idle') {
    return '空闲';
  }
  if (normalized === 'completed') {
    return '已完成';
  }
  if (normalized === 'streaming') {
    return '回复中';
  }
  if (normalized === 'blocked') {
    return '受阻';
  }
  return normalized;
}

export function avatarStatusMessage(action: ZhiyuAvatarLaunchAction): string {
  if (action.state === 'ready') {
    return '可以从输入区启动形象。';
  }
  if (action.state === 'blocked') {
    return '形象配置由 Avatar 管理。';
  }
  return '形象入口已保留，等待上游配置。';
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
      text: runtimeTextForDisplay(message.text),
    }));
}

function isEmptyStreamingTranscriptPlaceholder(message: ZhiyuEvidence['chat']['messages'][number]): boolean {
  const streaming = message.kind === 'streaming' || message.status === 'streaming';
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
