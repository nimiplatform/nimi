import {
  Button,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatComposerAdapter } from '@nimiplatform/kit/features/chat/headless';
import {
  CanonicalComposer,
  CanonicalTranscriptView,
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/ui';
import {
  X,
} from 'lucide-react';
import type { ZhiyuDelegationApprovalDecision, ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuCapabilityStudioCapabilityId } from '../app/developer-capability-studio';
import type { ZhiyuCapabilityRoomState } from '../app/capability-room-state';
import type { ZhiyuDiagnosticState } from '../app/diagnostic-state';
import type {
  ZhiyuHomeGatedSurface,
  ZhiyuHomeProductState,
} from '../app/home-product-state';
import type { ZhiyuIdentityFloorState } from '../app/identity-floor-state';
import { CompanionStateSection } from '../app/home-companion-state-section';
import { DeveloperBackstageSurface } from '../app/home-developer-backstage';
import { DelegationUxSection } from '../app/home-delegation-ux-section';
import { DiaryReflectionSection } from '../app/home-diary-reflection-section';
import {
  DesktopPresenceRail,
  RelationshipRail,
} from './ZhiyuAgentPanel';
import {
  chatBlockedHint,
  chatPrimaryBindingLabel,
  chatReplyChipLabel,
  conversationMessagesForDisplay,
  currentPartnerDisplayName,
  formatZhiyuTranscriptDateLabel,
  primaryActionForStage,
} from './ZhiyuAgentChatLabels';
import {
  ComposerAvatarButton,
  ComposerModeTools,
  RuntimeActionArtifactSummary,
  RuntimeChatFailureNotice,
  runtimeActionArtifactSummary,
} from './ZhiyuAgentChatPieces';
import {
  RightAgentPanel,
  type AgentPanelTab,
  type RightPanelMode,
} from './ZhiyuAgentRightPanel';
import { MemoryObservatorySection } from '../app/home-memory-observatory-section';
import { ProposalIntakeSection } from '../app/home-proposal-intake-section';
import {
  AvatarPresenceSection,
  CapabilityRoomSection,
  DiagnosticSurface,
  IdentityFloorSection,
  formatReasonLabel,
} from '../app/home-surface-sections';
import { ZHIYU_PRODUCT_STORYBOOK_VERSION } from '../app/zhiyu-product-storybook';
import '../app/home-surface.css';

export type ZhiyuAgentChatSurfaceProps = {
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
  readonly modelConfigContent?: ReactNode;
  readonly onDraftChange: (value: string) => void;
  readonly onCapabilityPromptChange: (value: string) => void;
  readonly onSubmit: (text: string) => Promise<void> | void;
  readonly onStopChat: () => void;
  readonly onCapabilityStudioRun: (capabilityId: ZhiyuCapabilityStudioCapabilityId) => void;
  readonly onProposalSubmit: () => void;
  readonly onDelegationDecision: (
    approvalRequestId: string,
    decision: ZhiyuDelegationApprovalDecision,
  ) => void;
  readonly onSelectLocalAgent: (localAgentRef: string) => void;
  readonly onAvatarLaunch?: () => void;
  readonly onAvatarManage?: () => void;
};

export function ZhiyuAgentChatSurface({
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
  modelConfigContent,
  onDraftChange,
  onCapabilityPromptChange,
  onSubmit,
  onStopChat,
  onCapabilityStudioRun,
  onProposalSubmit,
  onDelegationDecision,
  onSelectLocalAgent,
  onAvatarLaunch,
  onAvatarManage,
}: ZhiyuAgentChatSurfaceProps) {
  const modelConfigLabel = chatPrimaryBindingLabel(evidence);
  const currentPartnerName = currentPartnerDisplayName(evidence);
  const hasCurrentPartner = evidence.localAgent.ready;
  const primaryPartnerName = hasCurrentPartner ? '当前伙伴' : currentPartnerName;
  const modelConfigured = Boolean(evidence.route.executionBinding);
  const showCapabilityStudio = hasCurrentPartner && modelConfigured;
  const actionArtifactSummary = runtimeActionArtifactSummary(evidence.chat);
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
    <div
      className="zhiyu-home__chat-stream-footer"
      data-zhiyu-agent-chat-stop-state="available"
    >
      <ChatStreamStatus
        mode="streaming"
        partialText={evidence.chat.latestAssistantText || '等待当前伙伴回复...'}
        reasoningText={evidence.chat.reasoningText}
        reasoningLabel="思考片段"
      />
      <button
        type="button"
        className="zhiyu-home__chat-stop-button"
        data-zhiyu-chat-stop-action="true"
        data-zhiyu-agent-chat-stop-state="available"
        aria-label="停止当前回复"
        onClick={onStopChat}
      >
        <X size={16} aria-hidden="true" />
        <span>停止回复</span>
      </button>
    </div>
  ) : null;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('closed');
  const [activeAgentTab, setActiveAgentTab] = useState<AgentPanelTab>('overview');
  const chatTranscriptViewportRef = useRef<HTMLDivElement>(null);
  const composerRootRef = useRef<HTMLDivElement>(null);
  const getChatTranscriptRoot = useCallback(() => (
    chatTranscriptViewportRef.current?.querySelector<HTMLElement>('[data-canonical-transcript-root="true"]') ?? null
  ), []);
  const scrollChatTranscriptToLatest = useCallback(() => {
    const root = getChatTranscriptRoot();
    if (!root) {
      return;
    }
    root.scrollTop = root.scrollHeight;
  }, [getChatTranscriptRoot]);
  const primaryMemorySurface = product.gatedSurfaces.find((surface) => surface.key === 'memory');
  const primaryAvatarSurface = product.gatedSurfaces.find((surface) => surface.key === 'avatar');
  const primaryCompanionSurface = product.gatedSurfaces.find((surface) => surface.key === 'companion');
  const primaryAction = primaryActionForStage(product.stage);
  const openModelConfig = () => {
    setRightPanelMode('agent');
    setActiveAgentTab('model');
  };
  const openAppearanceConfig = () => {
    setRightPanelMode('agent');
    setActiveAgentTab('appearance');
  };
  const openBehaviorConfig = () => {
    setRightPanelMode('agent');
    setActiveAgentTab('behavior');
  };
  const openAdvancedSettings = () => {
    setRightPanelMode('agent');
    setActiveAgentTab('advanced');
  };
  const handlePrimaryAction = () => {
    if (primaryAction.kind === 'configure-model') {
      openModelConfig();
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
  useLayoutEffect(() => {
    if (evidence.chat.messageCount <= 0) {
      return;
    }
    scrollChatTranscriptToLatest();
  }, [
    evidence.chat.latestAssistantText,
    evidence.chat.messageCount,
    evidence.chat.requestId,
    evidence.chat.state,
    scrollChatTranscriptToLatest,
  ]);
  useEffect(() => {
    if (evidence.chat.messageCount <= 0) {
      return undefined;
    }
    let frameId: number | null = null;
    const scheduleScroll = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        scrollChatTranscriptToLatest();
      });
    };
    const root = getChatTranscriptRoot();
    const content = root?.querySelector<HTMLElement>('[data-canonical-transcript-width]') ?? null;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleScroll) : null;
    if (root && observer) {
      observer.observe(root);
    }
    if (content && observer) {
      observer.observe(content);
    }
    window.addEventListener('resize', scheduleScroll);
    scheduleScroll();
    return () => {
      window.removeEventListener('resize', scheduleScroll);
      observer?.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    evidence.chat.messageCount,
    getChatTranscriptRoot,
    scrollChatTranscriptToLatest,
  ]);
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
      <div
        className={`zhiyu-home__layout zhiyu-home__shell-grid${rightPanelMode === 'closed' ? ' is-side-closed' : ''}`}
        data-zhiyu-side-panel-state={rightPanelMode}
      >
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
            <div ref={chatTranscriptViewportRef} className="zhiyu-home__chat-transcript">
              <CanonicalTranscriptView
                messages={conversationMessagesForDisplay(evidence.chat.messages, primaryPartnerName)}
                activeConversationId={evidence.conversation.conversationAnchorId}
                agentName={primaryPartnerName}
                formatDateLabel={formatZhiyuTranscriptDateLabel}
                emptyEyebrow="ZH IYU"
                emptyTitle={hasCurrentPartner ? '开始一段对话' : '选择本地伙伴开始对话'}
                emptyDescription={hasCurrentPartner ? '提个问题、分享想法，或者告诉这个伙伴你想探索什么。' : '当前没有可打开的伙伴；请先到 Desktop Explore 的角色/人格页确认伙伴来源。织羽只承载真实伙伴，不伪造身份。'}
                footerContent={chatFooter}
                widthClassName="w-full max-w-none"
                widthPositionClassName="mx-0"
                scrollViewportWidthClassName="w-full"
                contentPaddingBottomClassName="pb-3"
                disableRpContent
              />
            </div>
            {actionArtifactSummary ? (
              <RuntimeActionArtifactSummary summary={actionArtifactSummary} />
            ) : null}
            {evidence.chat.state === 'failed' ? (
              <RuntimeChatFailureNotice chat={evidence.chat} />
            ) : null}
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
                placeholder={hasCurrentPartner ? '和这个伙伴聊点什么...' : '先选择本地伙伴...'}
                runtimeHint={chatRuntimeHint}
                modelLabel={<span>{modelConfigLabel}</span>}
                sendHint={evidence.chat.state === 'streaming' ? '回复中' : undefined}
                leadingSlot={(
                  <ComposerAvatarButton
                    currentPartnerName={currentPartnerName}
                    hasCurrentPartner={hasCurrentPartner}
                    avatarLaunchAction={avatarLaunchAction}
                    onAvatarLaunch={onAvatarLaunch}
                    onOpenSettings={openAppearanceConfig}
                  />
                )}
                toolbarSlot={(
                  <ComposerModeTools
                    evidence={evidence}
                    onOpenModelConfig={openModelConfig}
                    onOpenAgentPanel={() => {
                      setRightPanelMode('agent');
                      setActiveAgentTab('overview');
                    }}
                    onOpenSettings={openBehaviorConfig}
                  />
                )}
                layout="stacked"
                className="zhiyu-home__canonical-composer"
              />
            </div>
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

        {rightPanelMode !== 'closed' ? (
          <RightAgentPanel
            mode={rightPanelMode}
            evidence={evidence}
            currentPartnerName={currentPartnerName}
            hasCurrentPartner={hasCurrentPartner}
            modelConfigLabel={modelConfigLabel}
            modelConfigContent={modelConfigContent}
            diagnostics={diagnostics}
            technicalSurfaces={technicalSurfaces}
            primaryMemorySurface={primaryMemorySurface}
            primaryCompanionSurface={primaryCompanionSurface}
            primaryAvatarSurface={primaryAvatarSurface}
            avatarLaunchAction={avatarLaunchAction}
            activeTab={activeAgentTab}
            onActiveTabChange={setActiveAgentTab}
            onClose={() => setRightPanelMode('closed')}
            onOpenModelConfig={openModelConfig}
            onAvatarLaunch={onAvatarLaunch}
            renderGatedSurface={renderGatedSurface}
          />
        ) : null}
        <RelationshipRail
          agents={evidence.inventory.localAgents.map((agent) => ({
            itemKey: agent.localAgentRef,
            localAgentRef: agent.localAgentRef,
            displayName: agent.displayName,
          }))}
          currentLocalAgentRef={evidence.localAgent.localAgentRef}
          currentPartnerName={currentPartnerName}
          hasCurrentPartner={hasCurrentPartner}
          primaryActionKind={primaryAction.kind}
          runtimeReady={evidence.runtime.ready}
          onPrimaryAction={handlePrimaryAction}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
          onOpenSettings={openAdvancedSettings}
          onSelectLocalAgent={(localAgentRef) => {
            setActiveAgentTab('overview');
            onSelectLocalAgent(localAgentRef);
          }}
        />
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
              onOpenModelConfig={openModelConfig}
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
