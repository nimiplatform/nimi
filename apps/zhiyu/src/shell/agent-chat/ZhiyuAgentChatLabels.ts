import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';

export function chatPrimaryBindingLabel(evidence: ZhiyuEvidence): string {
  const binding = evidence.route.executionBinding;
  if (!binding) {
    return '未绑定模型';
  }
  if (binding.route === 'local') {
    return '本地对话已就绪';
  }
  return '对话已就绪';
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
    if (evidence.inventory.localAgents.length === 0) {
      return '添加本地伙伴后开始聊天。';
    }
    return '请先选择已存在的本地伙伴。';
  }
  if (!evidence.conversation.ready) {
    return conversationReadinessHint(evidence.conversation);
  }
  if (!evidence.route.ready) {
    return agentAIConfigReadinessHint(evidence.route);
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
    return '本地应用桥接暂时不可用，请重启织羽。';
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

// Readiness tri-state product copy for the composer gate. The unavailable
// reason codes come from the Runtime Agent AI Config readiness projection
// (.nimi/spec/runtime/kernel/tables/runtime-agent-ai-config.yaml).
export function agentAIConfigReadinessHint(route: ZhiyuEvidence['route']): string {
  if (route.reasonCode === 'zhiyu-agent-ai-config-auth-required') {
    return '请先登录本地运行服务账户。';
  }
  if (route.reasonCode === 'zhiyu-agent-ai-config-identity-required') {
    return '请先选择本地伙伴。';
  }
  if (route.reasonCode === 'zhiyu-agent-ai-config-unavailable') {
    return '本地运行服务暂时不可用，请稍后重试。';
  }
  const text = route.capabilities['text.generate'] ?? null;
  if (!text || text.state === 'not_configured' || route.reasonCode === 'zhiyu-agent-ai-config-not-configured') {
    return '请先在伙伴中心完成模型配置。';
  }
  if (text.state === 'unavailable') {
    return executionUnavailableReasonCopy(text.reasonCode);
  }
  return '模型配置暂时不可用，请稍后重试。';
}

function executionUnavailableReasonCopy(reasonCode: string): string {
  if (reasonCode === 'route_unhealthy') {
    return '模型通路暂不可用，请检查本地模型服务或云端连接。';
  }
  if (reasonCode === 'connector_missing') {
    return '云端连接器缺失，请重新完成模型配置。';
  }
  if (reasonCode === 'model_missing') {
    return '所选模型不可用，请重新选择模型。';
  }
  if (reasonCode === 'target_missing') {
    return '模型目标缺失，请重新完成模型配置。';
  }
  if (reasonCode === 'probe_failed') {
    return '模型可用性检查失败，请稍后重试。';
  }
  return '模型暂时不可用，请稍后重试。';
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

export function agentCenterWorldLabel(evidence: ZhiyuEvidence): string | null {
  const selectedRef = evidence.localAgent.localAgentRef;
  const fromInventory = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === selectedRef);
  if (fromInventory?.sourceKind !== 'worldCharacter') {
    return null;
  }
  return normalizedWorldName(fromInventory.sourceWorldName);
}

function normalizedWorldName(value: string | null | undefined): string | null {
  const worldName = value?.trim();
  if (!worldName) {
    return null;
  }
  return worldName;
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
