import {
  Button,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/kit/ui';
import { useRef, useState } from 'react';
import type { ChatComposerAdapter } from '@nimiplatform/kit/features/chat/headless';
import {
  CanonicalComposer,
  CanonicalTranscriptView,
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/ui';
import {
  Bell,
  CircleUserRound,
  Send,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { ZhiyuDelegationApprovalDecision, ZhiyuEvidence } from './evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuCapabilityStudioCapabilityId } from '../capability-studio/zhiyu-ai-consume';
import type { ZhiyuCapabilityRoomState } from './capability-room-state';
import type { ZhiyuDiagnosticState } from './diagnostic-state';
import type {
  ZhiyuHomeGatedSurface,
  ZhiyuHomeProductState,
} from './home-product-state';
import type { ZhiyuIdentityFloorState } from './identity-floor-state';
import { CompanionStateSection } from './home-companion-state-section';
import { DeveloperBackstageSurface } from './home-developer-backstage';
import { DelegationUxSection } from './home-delegation-ux-section';
import { DiaryReflectionSection } from './home-diary-reflection-section';
import {
  DesktopPresenceRail,
  RelationshipRail,
} from './home-desktop-chat-shell-chrome';
import { MemoryObservatorySection } from './home-memory-observatory-section';
import { ProposalIntakeSection } from './home-proposal-intake-section';
import {
  AvatarPresenceSection,
  CapabilityRoomSection,
  DiagnosticSurface,
  IdentityFloorSection,
  formatReasonLabel,
} from './home-surface-sections';
import { ZHIYU_PRODUCT_STORYBOOK_VERSION } from './zhiyu-product-storybook';
import './home-surface.css';

type HomeSurfaceProps = {
  readonly evidence: ZhiyuEvidence;
  readonly product: ZhiyuHomeProductState;
  readonly capabilityRoom: ZhiyuCapabilityRoomState;
  readonly diagnostics: ZhiyuDiagnosticState;
  readonly identityFloor: ZhiyuIdentityFloorState;
  readonly draft: string;
  readonly capabilityPrompt: string;
  readonly submitEnabled: boolean;
  readonly composerState: string;
  readonly capabilityStudioDisabled: boolean;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly onDraftChange: (value: string) => void;
  readonly onCapabilityPromptChange: (value: string) => void;
  readonly onSubmit: (text: string) => Promise<void> | void;
  readonly onCapabilityStudioRun: (capabilityId: ZhiyuCapabilityStudioCapabilityId) => void;
  readonly onProposalSubmit: () => void;
  readonly onDelegationDecision: (
    approvalRequestId: string,
    decision: ZhiyuDelegationApprovalDecision,
  ) => void;
  readonly onOpenModelConfig: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly onAvatarManage?: () => void;
};

export function HomeSurface({
  evidence,
  product,
  capabilityRoom,
  diagnostics,
  identityFloor,
  draft,
  capabilityPrompt,
  submitEnabled,
  composerState,
  capabilityStudioDisabled,
  avatarLaunchAction,
  onDraftChange,
  onCapabilityPromptChange,
  onSubmit,
  onCapabilityStudioRun,
  onProposalSubmit,
  onDelegationDecision,
  onOpenModelConfig,
  onAvatarLaunch,
  onAvatarManage,
}: HomeSurfaceProps) {
  const rawModelConfigLabel = routeModelBindingLabel(evidence);
  const modelConfigLabel = chatPrimaryBindingLabel(evidence);
  const currentPartnerName = currentPartnerDisplayName(evidence);
  const hasCurrentPartner = evidence.localAgent.ready;
  const modelConfigured = Boolean(evidence.route.executionBinding);
  const showCapabilityStudio = hasCurrentPartner && modelConfigured;
  const chatComposerAdapter: ChatComposerAdapter<never> = {
    submit: async (input) => {
      await onSubmit(input.text);
    },
  };
  const chatDisabled = !evidence.conversation.ready
    || !evidence.route.executionBinding
    || evidence.chat.state === 'streaming';
  const chatRuntimeHint = chatDisabled
    ? (
      evidence.chat.state === 'streaming'
        ? '当前伙伴正在回复。'
        : chatBlockedHint(evidence)
    )
    : null;
  const chatFooter = evidence.chat.state === 'streaming' ? (
    <ChatStreamStatus
      mode="streaming"
      partialText={evidence.chat.latestAssistantText || '等待当前伙伴回复...'}
      reasoningText={evidence.chat.reasoningText}
      reasoningLabel="思考片段"
    />
  ) : null;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const composerRootRef = useRef<HTMLDivElement>(null);
  const primaryMemorySurface = product.gatedSurfaces.find((surface) => surface.key === 'memory');
  const primaryAvatarSurface = product.gatedSurfaces.find((surface) => surface.key === 'avatar');
  const primaryCompanionSurface = product.gatedSurfaces.find((surface) => surface.key === 'companion');
  const partnerRailAgents = evidence.inventory.localAgents.length > 0
    ? evidence.inventory.localAgents.slice(0, 3).map((agent) => ({
        itemKey: agent.localAgentRef,
        localAgentRef: agent.localAgentRef,
        displayName: agent.displayName,
      }))
    : [{
        itemKey: 'partner-required',
        localAgentRef: null,
        displayName: currentPartnerName,
      }];
  const primaryAction = primaryActionForStage(product.stage);
  const handlePrimaryAction = () => {
    if (primaryAction.kind === 'configure-model') {
      onOpenModelConfig();
      return;
    }
    if (primaryAction.kind === 'start-chat') {
      const textarea = composerRootRef.current?.querySelector<HTMLTextAreaElement>('textarea');
      textarea?.focus();
      composerRootRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setDiagnosticsOpen(true);
  };
  const technicalSurfaces = product.gatedSurfaces.filter((surface) => (
    surface.key !== 'memory' && surface.key !== 'avatar' && surface.key !== 'companion'
  ));
  const renderGatedSurface = (surface: ZhiyuHomeGatedSurface) => {
    if (surface.key === 'capability') {
      return <CapabilityRoomSection key={surface.key} capabilityRoom={capabilityRoom} />;
    }
    if (surface.key === 'proposal') {
      return (
        <ProposalIntakeSection
          key={surface.key}
          surface={surface}
          proposal={evidence.proposal}
          onSubmit={onProposalSubmit}
        />
      );
    }
    if (surface.key === 'delegation') {
      return (
        <DelegationUxSection
          key={surface.key}
          surface={surface}
          delegation={evidence.delegation}
          onDecision={onDelegationDecision}
        />
      );
    }
    if (surface.key === 'identity') {
      return <IdentityFloorSection key={surface.key} surface={surface} identityFloor={identityFloor} />;
    }
    if (surface.key === 'companion') {
      return <CompanionStateSection key={surface.key} surface={surface} companion={evidence.companion} />;
    }
    if (surface.key === 'diary') {
      return <DiaryReflectionSection key={surface.key} surface={surface} diary={evidence.diaryReflection} />;
    }
    if (surface.key === 'avatar') {
      return (
        <AvatarPresenceSection
          key={surface.key}
          surface={surface}
          avatar={evidence.avatar}
          onLaunch={onAvatarLaunch}
          onManage={onAvatarManage}
        />
      );
    }
    return <MemoryObservatorySection key={surface.key} surface={surface} memory={evidence.memory} />;
  };
  return (
    <main
      className="zhiyu-home"
      data-zhiyu-screen="home"
      data-zhiyu-product-stage={product.stage}
      data-zhiyu-readiness-score={product.readinessScore}
      data-zhiyu-storybook-version={ZHIYU_PRODUCT_STORYBOOK_VERSION}
    >
      <div
        className="zhiyu-home__workspace"
        data-zhiyu-product-shell="workspace"
        data-zhiyu-primary-ui="true"
      >
      <div className="zhiyu-home__layout zhiyu-home__shell-grid">
        <DesktopPresenceRail
          evidence={evidence}
          product={product}
          diagnosticsOpen={diagnosticsOpen}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        />

        <Surface
          as="section"
          className="zhiyu-home__conversation"
          data-zhiyu-region="conversation"
          material="glass-thin"
          elevation="base"
          padding="md"
        >
          <div className="zhiyu-home__stage-topbar">
            <div>
              <span className="zhiyu-home__stage-kicker">织羽 Zhiyu</span>
              <h1>{hasCurrentPartner ? currentPartnerName : '选择本地伙伴'}</h1>
            </div>
            <div className="zhiyu-home__stage-actions" aria-label="对话操作">
              <button type="button" aria-label="通知">
                <Bell size={21} aria-hidden="true" />
              </button>
              <button type="button" aria-label="账户">
                <CircleUserRound size={23} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div
            className="zhiyu-home__model-config-row"
            data-zhiyu-ai-config-chip="agent-home"
            data-zhiyu-ai-config-ready={String(Boolean(evidence.route.executionBinding))}
            data-zhiyu-ai-config-enabled-capabilities={evidence.route.enabledCapabilities.join(',')}
            data-zhiyu-ai-config-binding-label={rawModelConfigLabel}
            data-zhiyu-ai-config-raw-binding-label={rawModelConfigLabel}
            data-zhiyu-ai-config-user-label={modelConfigLabel}
            data-zhiyu-ai-config-button-disabled={String(!evidence.runtime.ready)}
          >
            <Button
              type="button"
              tone="secondary"
              size="sm"
              data-zhiyu-model-config-entry="conversation"
              leadingIcon={<SlidersHorizontal size={15} aria-hidden="true" />}
              disabled={!evidence.runtime.ready}
              onClick={onOpenModelConfig}
            >
              模型配置
            </Button>
            <span>{modelConfigLabel}</span>
          </div>
          <div
            className="zhiyu-home__chat-shell"
            data-zhiyu-agent-chat-state={evidence.chat.state}
            data-zhiyu-agent-chat-ready={String(evidence.chat.ready)}
            data-zhiyu-agent-chat-reason={evidence.chat.reasonCode}
            data-zhiyu-agent-chat-message-count={String(evidence.chat.messageCount)}
            data-zhiyu-agent-chat-event-types={evidence.chat.eventTypes.join(',')}
            data-zhiyu-agent-chat-request-id={evidence.chat.requestId ?? 'not_projected'}
            data-zhiyu-agent-chat-anchor-id={evidence.chat.conversationAnchorId ?? 'not_projected'}
          >
            <div className="zhiyu-home__chat-transcript">
              <CanonicalTranscriptView
                messages={productConversationMessages(evidence.chat.messages, currentPartnerName)}
                activeConversationId={evidence.conversation.conversationAnchorId}
                agentName={currentPartnerName}
                formatDateLabel={formatZhiyuTranscriptDateLabel}
                emptyEyebrow="ZH IYU"
                emptyTitle={hasCurrentPartner ? `和 ${currentPartnerName} 开始对话` : '选择本地伙伴开始对话'}
                emptyDescription={hasCurrentPartner ? '发送一条消息，开始这次本地对话。' : '当前没有可打开的伙伴；请先到 Desktop Explore 的角色/人格页确认伙伴来源。织羽只承载真实伙伴，不伪造身份。'}
                footerContent={chatFooter}
                widthClassName="w-full max-w-none"
                widthPositionClassName="mx-0"
                scrollViewportWidthClassName="w-full"
                contentPaddingBottomClassName="pb-3"
                disableRpContent
              />
            </div>
            <div
              ref={composerRootRef}
              className="zhiyu-home__composer"
              data-zhiyu-composer-state={composerState}
              data-zhiyu-submit-enabled={String(submitEnabled)}
            >
              <CanonicalComposer
                adapter={chatComposerAdapter}
                text={draft}
                onTextChange={onDraftChange}
                disabled={chatDisabled}
                placeholder={hasCurrentPartner ? `向 ${currentPartnerName} 发送消息...` : '先选择本地伙伴...'}
                runtimeHint={chatRuntimeHint}
                modelLabel={<span>{modelConfigLabel}</span>}
                sendHint={evidence.chat.state === 'streaming' ? 'Streaming' : undefined}
                layout="stacked"
                className="zhiyu-home__canonical-composer"
              />
            </div>
          </div>
          <div
            className="zhiyu-home__fallback-composer-hidden"
            aria-hidden="true"
            data-zhiyu-fallback-composer-state={composerState}
            data-zhiyu-fallback-submit-enabled={String(submitEnabled)}
          >
            <TextareaField
              aria-label="当前伙伴消息"
              value={draft}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
              disabled={!evidence.conversation.ready || !evidence.route.executionBinding}
              rows={4}
              placeholder="等当前伙伴准备好后，在这里开始第一句话。"
              textareaClassName="zhiyu-home__composer-input"
            />
            <Button
              type="submit"
              disabled={!submitEnabled}
              tone="primary"
              size="md"
              leadingIcon={<Send size={16} aria-hidden="true" />}
            >
              发送
            </Button>
          </div>
          <div className="zhiyu-home__conversation-status">
            <span className="zhiyu-home__labeled-chip" data-zhiyu-labeled-chip="conversation">
              <span className="zhiyu-home__chip-label">会话</span>
              <StatusBadge tone={evidence.conversation.ready ? 'success' : 'warning'} shape="dot">
                {formatReasonLabel(evidence.conversation.ready, evidence.conversation.reasonCode)}
              </StatusBadge>
            </span>
            <span className="zhiyu-home__labeled-chip" data-zhiyu-labeled-chip="route">
              <span className="zhiyu-home__chip-label">模型</span>
              <StatusBadge tone={evidence.route.ready ? 'success' : 'warning'} shape="dot">
                {formatReasonLabel(evidence.route.ready, evidence.route.reasonCode)}
              </StatusBadge>
            </span>
            <span className="zhiyu-home__labeled-chip" data-zhiyu-labeled-chip="chat">
              <span className="zhiyu-home__chip-label">回复</span>
              <StatusBadge tone={evidence.chat.ready ? 'success' : evidence.chat.state === 'failed' ? 'danger' : evidence.chat.state === 'idle' ? 'neutral' : 'warning'} shape="dot">
                {chatReplyChipLabel(evidence)}
              </StatusBadge>
            </span>
          </div>
          <p
            data-zhiyu-conversation-state={evidence.conversation.reasonCode}
            data-zhiyu-conversation-source={evidence.conversation.source}
            data-zhiyu-conversation-ready={String(evidence.conversation.ready)}
            className="zhiyu-home__evidence-line"
          >
            {evidence.conversation.message}
          </p>
          <p
            data-zhiyu-route-state={evidence.route.reasonCode}
            data-zhiyu-route-source={evidence.route.source}
            data-zhiyu-route-ready={String(evidence.route.ready)}
            className="zhiyu-home__evidence-line"
          >
            {evidence.route.message}
          </p>
          <p
            data-zhiyu-turn-state={evidence.chat.reasonCode}
            data-zhiyu-turn-source={evidence.chat.source}
            data-zhiyu-turn-ready={String(evidence.chat.ready)}
            className="zhiyu-home__evidence-line"
          >
            {evidence.chat.message}
          </p>
        </Surface>

        <RelationshipRail
          agents={partnerRailAgents}
          currentPartnerName={currentPartnerName}
          hasCurrentPartner={hasCurrentPartner}
          primaryActionKind={primaryAction.kind}
          avatarLaunchAction={avatarLaunchAction}
          runtimeReady={evidence.runtime.ready}
          onPrimaryAction={handlePrimaryAction}
          onAvatarLaunch={onAvatarLaunch}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
          onOpenModelConfig={onOpenModelConfig}
        />
        <div className="zhiyu-home__primary-side-evidence" aria-hidden="true">
          {primaryMemorySurface ? renderGatedSurface(primaryMemorySurface) : null}
          {primaryCompanionSurface ? renderGatedSurface(primaryCompanionSurface) : null}
          {primaryAvatarSurface ? renderGatedSurface(primaryAvatarSurface) : null}
        </div>
      </div>
      </div>
      <div
        id="zhiyu-diagnostics-drawer"
        className="zhiyu-home__diagnostics-layer"
        data-zhiyu-diagnostics-drawer={diagnosticsOpen ? 'open' : 'closed'}
        hidden={!diagnosticsOpen}
      >
        <aside
          className="zhiyu-home__diagnostics-drawer"
          role="dialog"
          aria-modal="false"
          aria-label="Runtime diagnostics"
        >
          <div className="zhiyu-home__diagnostics-header">
            <div>
              <strong>Runtime 诊断</strong>
              <span>技术投影和未开放能力保留在这里，不污染主工作区。</span>
            </div>
            <Button
              type="button"
              tone="secondary"
              size="sm"
              leadingIcon={<X size={15} aria-hidden="true" />}
              data-zhiyu-diagnostics-toggle="close"
              onClick={() => setDiagnosticsOpen(false)}
            >
              关闭
            </Button>
          </div>
          <div className="zhiyu-home__diagnostics-content">
            <DeveloperBackstageSurface
              evidence={evidence}
              capabilityRoom={capabilityRoom}
              capabilityPrompt={capabilityPrompt}
              capabilityStudioDisabled={capabilityStudioDisabled}
              showCapabilityStudio={showCapabilityStudio}
              hasCurrentPartner={hasCurrentPartner}
              onCapabilityPromptChange={onCapabilityPromptChange}
              onCapabilityStudioRun={onCapabilityStudioRun}
              onOpenModelConfig={onOpenModelConfig}
              onSelectPartner={() => setDiagnosticsOpen(true)}
            />
            {technicalSurfaces.map(renderGatedSurface)}
            <DiagnosticSurface diagnostics={diagnostics} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function routeModelBindingLabel(evidence: ZhiyuEvidence): string {
  const binding = evidence.route.executionBinding;
  if (!binding) {
    return '未绑定模型';
  }
  return `${binding.route}:${binding.modelId}`;
}

function chatPrimaryBindingLabel(evidence: ZhiyuEvidence): string {
  const binding = evidence.route.executionBinding;
  if (!binding) {
    return '未绑定模型';
  }
  if (binding.route === 'local') {
    return '本地对话模型已绑定';
  }
  return '模型已绑定';
}

function chatReplyChipLabel(evidence: ZhiyuEvidence): string {
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

function chatBlockedHint(evidence: ZhiyuEvidence): string {
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

function currentPartnerDisplayName(evidence: ZhiyuEvidence): string {
  const selectedRef = evidence.localAgent.localAgentRef;
  const fromInventory = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === selectedRef);
  const displayName = productPartnerDisplayName(fromInventory?.displayName);
  if (displayName) {
    return displayName;
  }
  if (evidence.localAgent.ready) {
    return '当前伙伴';
  }
  return '本地伙伴';
}

function productPartnerDisplayName(value: string | null | undefined): string | null {
  const displayName = value?.trim();
  if (!displayName) {
    return null;
  }
  if (/runtime|localagent|local agent|fixture|e2e|source/i.test(displayName)) {
    return null;
  }
  return displayName;
}

function primaryActionForStage(stage: ZhiyuHomeProductState['stage']): {
  readonly kind: 'connect-service' | 'select-partner' | 'configure-model' | 'start-chat';
  readonly label: string;
  readonly badgeLabel: string;
  readonly tone: 'primary' | 'secondary';
} {
  if (stage === 'route-required') {
    return {
      kind: 'configure-model',
      label: '配置模型',
      badgeLabel: '需要模型',
      tone: 'primary',
    };
  }
  if (stage === 'ready') {
    return {
      kind: 'start-chat',
      label: '开始对话',
      badgeLabel: '伙伴可对话',
      tone: 'secondary',
    };
  }
  if (stage === 'source-required' || stage === 'agent-required') {
    return {
      kind: 'select-partner',
      label: '查看伙伴入口',
      badgeLabel: '需要伙伴',
      tone: 'primary',
    };
  }
  return {
    kind: 'connect-service',
    label: '查看本地环境状态',
    badgeLabel: '需要连接',
    tone: 'secondary',
  };
}

function productConversationMessages(
  messages: ZhiyuEvidence['chat']['messages'],
  currentPartnerName: string,
): ZhiyuEvidence['chat']['messages'] {
  return messages.map((message) => ({
    ...message,
    senderName: productSenderName(message.senderName, currentPartnerName),
    text: productGeneratedText(message.text),
  }));
}

function productSenderName(value: string | null | undefined, currentPartnerName: string): string | null | undefined {
  if (value === 'You') return '你';
  if (value === 'Zhiyu Agent') return currentPartnerName;
  return value;
}

function productGeneratedText(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (/^Hello from the Runtime Agent live fixture\.$/.test(text)) {
    return '当前伙伴已完成本地对话校验，并返回一条可追踪的回复。';
  }
  return text;
}

function formatZhiyuTranscriptDateLabel({ date, diffDays }: { readonly date: Date; readonly diffDays: number }): string {
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date);
}
