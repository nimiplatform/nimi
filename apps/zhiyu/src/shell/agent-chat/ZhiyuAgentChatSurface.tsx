import {
  Button,
  EmptyState,
  InlineAlert,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatComposerAdapter } from '@nimiplatform/kit/features/chat/headless';
import {
  CanonicalComposer,
  CanonicalTranscriptView,
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/ui';
import {
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuDesktopOpenActionResult } from '../desktop-open/desktop-open-action';
import type {
  ZhiyuHomeProductState,
} from '../app/home-product-state';
import {
  DesktopPresenceRail,
} from './ZhiyuAgentPanel';
import {
  chatBlockedHint,
  chatPrimaryBindingLabel,
  chatReplyChipLabel,
  conversationMessagesForDisplay,
  currentPartnerDisplayName,
  formatZhiyuTranscriptDateLabel,
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
import {
  CompanionEmotionStatus,
  formatReasonLabel,
} from '../app/home-surface-sections';
import { ZHIYU_PRODUCT_STORYBOOK_VERSION } from '../app/zhiyu-product-storybook';
import '../app/home-surface.css';

export type ZhiyuAgentChatSurfaceProps = {
  readonly evidence: ZhiyuEvidence;
  readonly product: ZhiyuHomeProductState;
  readonly draft: string;
  readonly submitEnabled: boolean;
  readonly composerState: string;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: (text: string) => Promise<void> | void;
  readonly onStopChat: () => void;
  readonly onVoiceCaptureToggle: () => Promise<void> | void;
  readonly onSelectLocalAgent: (localAgentRef: string) => void;
  readonly onRefreshLocalAgentInventory: () => void;
  readonly onDesktopOpenSelectPartner: () => Promise<ZhiyuDesktopOpenActionResult> | ZhiyuDesktopOpenActionResult;
  readonly onAvatarLaunch?: () => void;
  readonly onAvatarManage?: () => void;
};

export function ZhiyuAgentChatSurface({
  evidence,
  product,
  draft,
  submitEnabled,
  composerState,
  avatarLaunchAction,
  onDraftChange,
  onSubmit,
  onStopChat,
  onVoiceCaptureToggle,
  onSelectLocalAgent,
  onRefreshLocalAgentInventory,
  onDesktopOpenSelectPartner,
  onAvatarLaunch,
}: ZhiyuAgentChatSurfaceProps) {
  const modelConfigLabel = chatPrimaryBindingLabel(evidence);
  const currentPartnerName = currentPartnerDisplayName(evidence);
  const hasCurrentPartner = evidence.localAgent.ready;
  const hasLocalPartners = evidence.inventory.localAgents.length > 0;
  const localAgentSourceNotReady = !hasCurrentPartner
    && evidence.localAgent.reasonCode === 'zhiyu-runtime-local-agent-source-not-ready';
  const primaryPartnerName = hasCurrentPartner ? '当前伙伴' : currentPartnerName;
  const actionArtifactSummary = runtimeActionArtifactSummary(evidence.chat);
  const [showNoPartnerGuidance, setShowNoPartnerGuidance] = useState(false);
  const [desktopOpenPending, setDesktopOpenPending] = useState(false);
  const [desktopOpenResult, setDesktopOpenResult] = useState<ZhiyuDesktopOpenActionResult | null>(null);
  const emptyTitle = hasCurrentPartner
    ? '开始一段对话'
    : localAgentSourceNotReady
      ? '伙伴资料尚未就绪'
    : hasLocalPartners
      ? '选择一位本地伙伴，开始对话'
      : '还没有本地伙伴';
  const emptyDescription = hasCurrentPartner
    ? '提个问题、分享想法，或者告诉这个伙伴你想探索什么。'
    : localAgentSourceNotReady
      ? '这个伙伴的来源资料还没有准备完成，暂时不能开始对话。请到 Nimi 桌面端继续选择伙伴来源，完成后回到这里重新检查。'
    : hasLocalPartners
      ? '如果想添加更多伙伴，请到Nimi桌面端的「探索」中选择角色。'
      : '从世界中选择一位角色加入本地后，就可以和他开始对话。';
  const sourceNotReadyEmptyState = localAgentSourceNotReady ? (
    <EmptyState
      className="zhiyu-source-not-ready-empty"
      data-zhiyu-source-not-ready-empty="true"
      data-zhiyu-source-not-ready-reason={evidence.localAgent.reasonCode}
      data-zhiyu-source-not-ready-action-hint={evidence.localAgent.actionHint}
      icon={<AlertTriangle size={20} aria-hidden="true" />}
      title="伙伴资料尚未就绪"
      description={(
        <div className="zhiyu-source-not-ready-empty__description">
          <p>这个伙伴的来源资料还没有准备完成，暂时不能开始对话。请到 Nimi 桌面端继续选择伙伴来源，完成后回到这里重新检查。</p>
          {desktopOpenResult ? (
            <InlineAlert
              tone={desktopOpenResult.state === 'accepted' ? 'info' : 'warning'}
              className="zhiyu-source-not-ready-empty__handoff"
              data-zhiyu-source-not-ready-handoff-state={desktopOpenResult.state}
            >
              {desktopOpenResult.message}
            </InlineAlert>
          ) : null}
          <details className="zhiyu-source-not-ready-empty__diagnostics">
            <summary>查看诊断信息</summary>
            <dl>
              <div>
                <dt>原因</dt>
                <dd><code data-zhiyu-source-not-ready-diagnostic="reason-code">{evidence.localAgent.reasonCode}</code></dd>
              </div>
              <div>
                <dt>下一步</dt>
                <dd><code data-zhiyu-source-not-ready-diagnostic="action-hint">{evidence.localAgent.actionHint}</code></dd>
              </div>
            </dl>
          </details>
        </div>
      )}
      action={(
        <div className="zhiyu-source-not-ready-empty__actions">
          <Button
            tone="primary"
            size="sm"
            loading={desktopOpenPending}
            trailingIcon={<ChevronRight size={16} aria-hidden="true" />}
            data-zhiyu-source-not-ready-action="desktop-open-select-partner"
            data-zhiyu-desktop-open-action="desktop_open_select_partner"
            onClick={() => {
              void handleDesktopOpenSelectPartner();
            }}
          >
            去桌面端继续准备
          </Button>
          <Button
            tone="secondary"
            size="sm"
            leadingIcon={<RefreshCw size={16} aria-hidden="true" />}
            data-zhiyu-source-not-ready-action="refresh-runtime-inventory"
            onClick={() => {
              setDesktopOpenResult(null);
              onRefreshLocalAgentInventory();
            }}
          >
            重新检查
          </Button>
        </div>
      )}
    />
  ) : null;
  const noLocalPartnerEmptyState = !hasCurrentPartner && !hasLocalPartners ? (
    <section
      className="zhiyu-no-local-partner-empty"
      data-zhiyu-no-local-partner-empty="true"
      aria-label="还没有本地伙伴"
    >
      <div className="zhiyu-no-local-partner-empty__inner">
        <p className="zhiyu-no-local-partner-empty__eyebrow">ZHI YU</p>
        <h2>还没有本地伙伴</h2>
        <p className="zhiyu-no-local-partner-empty__copy">
          从世界中选择一位角色加入本地后，就可以和他开始对话。
        </p>
        <button
          type="button"
          className="zhiyu-no-local-partner-empty__action"
          data-zhiyu-no-local-partner-action="desktop-open-select-partner"
          data-zhiyu-desktop-open-action="desktop_open_select_partner"
          data-zhiyu-no-local-partner-action-state={desktopOpenPending ? 'pending' : desktopOpenResult?.state ?? (showNoPartnerGuidance ? 'expanded' : 'idle')}
          aria-expanded={showNoPartnerGuidance}
          aria-controls="zhiyu-no-local-partner-guidance"
          onClick={() => {
            setShowNoPartnerGuidance(true);
            void handleDesktopOpenSelectPartner();
          }}
          disabled={desktopOpenPending}
        >
          <span>{desktopOpenPending ? '打开中' : '去探索伙伴'}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <p className="zhiyu-no-local-partner-empty__assurance">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>本地伙伴会保留角色来源与身份设定。</span>
        </p>
        {showNoPartnerGuidance ? (
          <p
            id="zhiyu-no-local-partner-guidance"
            className="zhiyu-no-local-partner-empty__handoff"
            data-zhiyu-no-local-partner-guidance="desktop-explore"
          >
            {desktopOpenResult?.message ?? '请打开 Nimi 桌面端「探索」页，选择角色并加入本地；织羽会在本地伙伴出现后显示在左侧。'}
          </p>
        ) : null}
      </div>
    </section>
  ) : null;
  const chatComposerAdapter: ChatComposerAdapter<never> = {
    submit: async (input) => {
      await onSubmit(input.text);
    },
  };
  const chatDisabled = !evidence.conversation.ready
    || !evidence.route.ready
    || evidence.chat.state === 'streaming';
  const chatRuntimeHint = chatDisabled && (hasCurrentPartner || evidence.chat.state === 'streaming')
    ? (
      evidence.chat.state === 'streaming'
        ? '当前伙伴正在回复。'
        : chatBlockedHint(evidence)
    )
    : null;
  const chatFooter = evidence.chat.state === 'streaming' ? (
    <div
      className="zhiyu-chat-canvas__stream-footer"
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
        className="zhiyu-chat-canvas__stop-button"
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
  const openAgentOverview = () => {
    setRightPanelMode('agent');
    setActiveAgentTab('overview');
  };
  const openAdvancedSettings = () => {
    setRightPanelMode('agent');
    setActiveAgentTab('advanced');
  };
  const handleDesktopOpenSelectPartner = async () => {
    if (desktopOpenPending) {
      return;
    }
    setDesktopOpenPending(true);
    try {
      setDesktopOpenResult(await onDesktopOpenSelectPartner());
    } finally {
      setDesktopOpenPending(false);
    }
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
  return (
    <main
      className="zhiyu-agent-chat"
      data-zhiyu-screen="home"
      data-zhiyu-product-stage={product.stage}
      data-zhiyu-readiness-score={product.readinessScore}
      data-zhiyu-agent-chat-shell="primary"
      data-zhiyu-storybook-version={ZHIYU_PRODUCT_STORYBOOK_VERSION}
    >
      <div
        className="zhiyu-agent-chat__workspace"
        data-zhiyu-product-shell="workspace"
        data-zhiyu-primary-ui="true"
      >
      <div
        className={`zhiyu-agent-chat__layout${rightPanelMode === 'closed' ? ' is-side-closed' : ''}`}
        data-zhiyu-side-panel-state={rightPanelMode}
        data-zhiyu-relationship-rail-state={hasLocalPartners ? 'available' : 'empty'}
      >
        <DesktopPresenceRail
          evidence={evidence}
          agents={evidence.inventory.localAgents.map((agent) => ({
            itemKey: agent.localAgentRef,
            localAgentRef: agent.localAgentRef,
            displayName: agent.displayName,
            sourceReady: agent.sourceReady,
          }))}
          currentLocalAgentRef={evidence.localAgent.localAgentRef}
          currentPartnerName={currentPartnerName}
          hasCurrentPartner={hasCurrentPartner}
          onOpenCurrentAgent={() => {
            setRightPanelMode('agent');
            setActiveAgentTab('overview');
          }}
          onOpenSettings={openAdvancedSettings}
          onSelectLocalAgent={(localAgentRef) => {
            setActiveAgentTab('overview');
            onSelectLocalAgent(localAgentRef);
          }}
        />

        <Surface
          as="section"
          className="zhiyu-chat-canvas"
          data-zhiyu-region="conversation"
          material="glass-thin"
          elevation="base"
          padding="md"
        >
          <div
            className="zhiyu-chat-canvas__shell"
            data-zhiyu-agent-chat-state={evidence.chat.state}
            data-zhiyu-agent-chat-ready={String(evidence.chat.ready)}
            data-zhiyu-agent-chat-reason={evidence.chat.reasonCode}
            data-zhiyu-agent-chat-message-count={String(evidence.chat.messageCount)}
            data-zhiyu-agent-chat-event-types={evidence.chat.eventTypes.join(',')}
            data-zhiyu-agent-chat-request-id={evidence.chat.requestId ?? 'not_projected'}
            data-zhiyu-agent-chat-anchor-id={evidence.chat.conversationAnchorId ?? 'not_projected'}
          >
            <div ref={chatTranscriptViewportRef} className="zhiyu-chat-canvas__transcript">
              <CanonicalTranscriptView
                messages={conversationMessagesForDisplay(evidence.chat.messages, primaryPartnerName)}
                activeConversationId={evidence.conversation.conversationAnchorId}
                agentName={primaryPartnerName}
                formatDateLabel={formatZhiyuTranscriptDateLabel}
                emptyEyebrow="ZHIYU"
                emptyTitle={emptyTitle}
                emptyDescription={emptyDescription}
                content={sourceNotReadyEmptyState ?? noLocalPartnerEmptyState}
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
              className="zhiyu-chat-canvas__composer"
              data-zhiyu-composer-state={composerState}
              data-zhiyu-submit-enabled={String(submitEnabled)}
            >
              <CanonicalComposer
                adapter={chatComposerAdapter}
                text={draft}
                onTextChange={onDraftChange}
                disabled={chatDisabled}
                placeholder={hasCurrentPartner ? '和这个伙伴聊点什么...' : localAgentSourceNotReady ? '伙伴资料准备完成后开始聊天...' : hasLocalPartners ? '先选择本地伙伴...' : '添加本地伙伴后开始聊天...'}
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
                    onVoiceCaptureToggle={onVoiceCaptureToggle}
                    onOpenModelConfig={openModelConfig}
                    onOpenAgentPanel={() => {
                      setRightPanelMode('agent');
                      setActiveAgentTab('overview');
                    }}
                    onOpenSettings={openBehaviorConfig}
                  />
                )}
                layout="stacked"
                className="zhiyu-chat-canvas__canonical-composer"
              />
            </div>
          </div>
          <div className="zhiyu-chat-canvas__status">
            <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-labeled-chip="conversation">
              <span className="zhiyu-chat-canvas__chip-label">会话</span>
              <StatusBadge tone={evidence.conversation.ready ? 'success' : 'warning'} shape="dot">
                {formatReasonLabel(evidence.conversation.ready, evidence.conversation.reasonCode)}
              </StatusBadge>
            </span>
            <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-labeled-chip="route">
              <span className="zhiyu-chat-canvas__chip-label">模型</span>
              <StatusBadge tone={evidence.route.ready ? 'success' : 'warning'} shape="dot">
                {formatReasonLabel(evidence.route.ready, evidence.route.reasonCode)}
              </StatusBadge>
            </span>
            <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-labeled-chip="chat">
              <span className="zhiyu-chat-canvas__chip-label">回复</span>
              <StatusBadge tone={evidence.chat.ready ? 'success' : evidence.chat.state === 'failed' ? 'danger' : evidence.chat.state === 'idle' ? 'neutral' : 'warning'} shape="dot">
                {chatReplyChipLabel(evidence)}
              </StatusBadge>
            </span>
            <CompanionEmotionStatus companion={evidence.companion} />
          </div>
          <p
            data-zhiyu-conversation-state={evidence.conversation.reasonCode}
            data-zhiyu-conversation-source={evidence.conversation.source}
            data-zhiyu-conversation-ready={String(evidence.conversation.ready)}
            className="zhiyu-agent-chat__evidence-line"
          >
            {evidence.conversation.message}
          </p>
          <p
            data-zhiyu-route-state={evidence.route.reasonCode}
            data-zhiyu-route-source={evidence.route.source}
            data-zhiyu-route-ready={String(evidence.route.ready)}
            className="zhiyu-agent-chat__evidence-line"
          >
            {evidence.route.message}
          </p>
          <p
            data-zhiyu-turn-state={evidence.chat.reasonCode}
            data-zhiyu-turn-source={evidence.chat.source}
            data-zhiyu-turn-ready={String(evidence.chat.ready)}
            className="zhiyu-agent-chat__evidence-line"
          >
            {evidence.chat.message}
          </p>
        </Surface>

        {rightPanelMode !== 'closed' ? (
          <RightAgentPanel
            mode={rightPanelMode}
            evidence={evidence}
            currentPartnerName={currentPartnerName}
            activeTab={activeAgentTab}
            onActiveTabChange={setActiveAgentTab}
            onClose={() => setRightPanelMode('closed')}
            onOpenModelConfig={openModelConfig}
            onAvatarLaunch={onAvatarLaunch}
          />
        ) : null}
      </div>
      </div>
    </main>
  );
}
