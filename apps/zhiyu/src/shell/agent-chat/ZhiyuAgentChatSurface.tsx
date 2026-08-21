import {
  nimiToast,
  StatusBadge,
} from '@nimiplatform/kit/ui';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatComposerAdapter } from '@nimiplatform/kit/features/chat/headless';
import {
  CanonicalComposer,
  CanonicalTranscriptView,
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/ui';
import {
  ChevronRight,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuDesktopOpenActionResult } from '../desktop-open/desktop-open-action';
import type { ZhiyuRendererProjectionPort } from '../../renderer/contract';
import type {
  ZhiyuHomeProductState,
} from '../app/home-product-state';
import {
  DesktopPresenceRail,
} from './ZhiyuAgentPanel';
import {
  chatBlockedHint,
  chatReplyChipLabel,
  conversationMessagesForDisplay,
  currentPartnerAvatarUrl,
  currentPartnerDisplayName,
  formatZhiyuTranscriptDateLabel,
} from './ZhiyuAgentChatLabels';
import {
  ComposerAvatarButton,
  ComposerModeTools,
  RuntimeChatFailureNotice,
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
import { followZhiyuTranscriptToLatest } from './transcript-auto-follow';

export type ZhiyuAgentChatSurfaceProps = {
  readonly evidence: ZhiyuEvidence;
  readonly product: ZhiyuHomeProductState;
  readonly draft: string;
  readonly submitEnabled: boolean;
  readonly composerState: string;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly agentCenterSession: ReturnType<ZhiyuRendererProjectionPort['agentCenterSession']>;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: (text: string) => Promise<void> | void;
  readonly onStopChat: () => void;
  readonly onSelectLocalAgent: (agentHandle: string) => void;
  readonly onDesktopOpenAgentConfig: () => Promise<void> | void;
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
  agentCenterSession,
  onDraftChange,
  onSubmit,
  onStopChat,
  onSelectLocalAgent,
  onDesktopOpenAgentConfig,
  onDesktopOpenSelectPartner,
  onAvatarLaunch,
}: ZhiyuAgentChatSurfaceProps) {
  const currentPartnerName = currentPartnerDisplayName(evidence);
  const currentPartnerAvatar = currentPartnerAvatarUrl(evidence);
  const hasCurrentPartner = evidence.localAgent.ready;
  const hasLocalPartners = evidence.inventory.localAgents.length > 0;
  const primaryPartnerName = hasCurrentPartner ? '当前伙伴' : currentPartnerName;
  const [showNoPartnerGuidance, setShowNoPartnerGuidance] = useState(false);
  const [desktopOpenPending, setDesktopOpenPending] = useState(false);
  const [desktopOpenResult, setDesktopOpenResult] = useState<ZhiyuDesktopOpenActionResult | null>(null);
  const emptyTitle = hasCurrentPartner
    ? '开始一段对话'
    : hasLocalPartners
      ? '选择一位本地伙伴，开始对话'
      : '还没有本地伙伴';
  const emptyDescription = hasCurrentPartner
    ? '提个问题、分享想法，或者告诉这个伙伴你想探索什么。'
    : hasLocalPartners
      ? '如果想添加更多伙伴，请到Nimi桌面端的「探索」中选择角色。'
      : '从世界中选择一位角色加入本地后，就可以和他开始对话。';
  const noLocalPartnerEmptyState = !hasCurrentPartner && !hasLocalPartners ? (
    <section
      className="zhiyu-no-local-partner-empty"
      data-zhiyu-no-local-partner-empty="true"
      aria-label="还没有本地伙伴"
    >
      <div className="zhiyu-no-local-partner-empty__inner">
        <p className="zhiyu-no-local-partner-empty__eyebrow">ZHI YU</p>
        <h2>还没有本地伙伴</h2>
        <p className="zhiyu-no-local-partner-empty__copy">{evidence.inventory.message}</p>
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
  const chatDisabled = !evidence.conversation.ready
    || !evidence.turn.ready
    || evidence.chat.state === 'streaming';
  const chatComposerAdapter: ChatComposerAdapter<never> = {
    submit: async (input) => {
      await onSubmit(input.text);
    },
  };
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
  const chatTranscriptEndRef = useRef<HTMLSpanElement>(null);
  const composerRootRef = useRef<HTMLDivElement>(null);
  const getChatTranscriptRoot = useCallback(() => (
    chatTranscriptViewportRef.current?.querySelector<HTMLElement>('[data-canonical-transcript-root="true"]') ?? null
  ), []);
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
  const handleDesktopOpenSelectPartner = async () => {
    if (desktopOpenPending) {
      return;
    }
    setDesktopOpenPending(true);
    try {
      const result = await onDesktopOpenSelectPartner();
      setDesktopOpenResult(result);
      nimiToast.show({
        tone: result.state === 'accepted' ? 'info' : 'warning',
        message: result.message,
      });
    } finally {
      setDesktopOpenPending(false);
    }
  };
  useLayoutEffect(() => {
    if (evidence.chat.messageCount <= 0) {
      return;
    }
    const root = getChatTranscriptRoot();
    const end = chatTranscriptEndRef.current;
    return root && end ? followZhiyuTranscriptToLatest(root, end) : undefined;
  }, [
    evidence.chat.latestAssistantText,
    evidence.chat.messageCount,
    evidence.chat.requestId,
    evidence.chat.state,
    getChatTranscriptRoot,
  ]);
  return (
    <main
      className="zhiyu-agent-chat"
      aria-label="织羽伙伴对话"
      data-zhiyu-screen="home"
      data-zhiyu-product-stage={product.stage}
      data-zhiyu-readiness-score={product.readinessScore}
      data-zhiyu-agent-chat-shell="primary"
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
          agents={evidence.inventory.localAgents.map((agent) => ({
            itemKey: agent.agentHandle,
            agentHandle: agent.agentHandle,
            displayName: agent.displayName,
            avatarUrl: agent.avatarUrl,
          }))}
          currentAgentHandle={evidence.localAgent.agentHandle}
          currentPartnerName={currentPartnerName}
          hasCurrentPartner={hasCurrentPartner}
          onOpenCurrentAgent={() => {
            setRightPanelMode('agent');
            setActiveAgentTab('overview');
          }}
          onSelectAgent={(agentHandle) => {
            setActiveAgentTab('overview');
            onSelectLocalAgent(agentHandle);
          }}
        />

        <section
          className="zhiyu-chat-canvas"
          data-zhiyu-region="conversation"
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
                content={noLocalPartnerEmptyState}
                footerContent={(
                  <>
                    {chatFooter}
                    <span
                      ref={chatTranscriptEndRef}
                      data-zhiyu-transcript-end="true"
                      aria-hidden="true"
                      className="block h-px w-full"
                    />
                  </>
                )}
                widthClassName="w-full max-w-none"
                widthPositionClassName="mx-0"
                scrollViewportWidthClassName="w-full"
                contentPaddingBottomClassName="pb-[clamp(160px,18vh,220px)]"
                disableRpContent
              />
            </div>
            {evidence.chat.state === 'failed' ? (
              <RuntimeChatFailureNotice chat={evidence.chat} />
            ) : null}
          </div>
            <div className="zhiyu-chat-canvas__overlay">
              <div className="zhiyu-chat-canvas__overlay-inner">
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
                placeholder={hasCurrentPartner ? '和这个伙伴聊点什么...' : hasLocalPartners ? '先选择本地伙伴...' : '添加本地伙伴后开始聊天...'}
                runtimeHint={chatRuntimeHint}
                sendHint={evidence.chat.state === 'streaming' ? '回复中' : undefined}
                leadingSlot={(
                  <ComposerAvatarButton
                    currentPartnerName={currentPartnerName}
                    currentPartnerAvatarUrl={currentPartnerAvatar}
                    hasCurrentPartner={hasCurrentPartner}
                    avatarLaunchAction={avatarLaunchAction}
                    onAvatarLaunch={onAvatarLaunch}
                    onOpenSettings={openAppearanceConfig}
                  />
                )}
                toolbarSlot={(
                  <ComposerModeTools
                    onOpenAgentPanel={() => {
                      setRightPanelMode('agent');
                      setActiveAgentTab('overview');
                    }}
                    onOpenSettings={openBehaviorConfig}
                  />
                )}
                className="zhiyu-chat-canvas__canonical-composer"
              />
                </div>
                <div className="zhiyu-chat-canvas__status">
            <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-labeled-chip="conversation">
              <span className="zhiyu-chat-canvas__chip-label">会话</span>
              <StatusBadge tone={evidence.conversation.ready ? 'success' : 'warning'} shape="dot">
                {formatReasonLabel(evidence.conversation.ready, evidence.conversation.reasonCode)}
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
              </div>
            </div>
        </section>

        {rightPanelMode !== 'closed' ? (
          <RightAgentPanel
            mode={rightPanelMode}
            evidence={evidence}
            currentPartnerName={currentPartnerName}
            activeTab={activeAgentTab}
            onActiveTabChange={setActiveAgentTab}
            onClose={() => setRightPanelMode('closed')}
            onOpenDesktopAgentConfig={() => { void onDesktopOpenAgentConfig(); }}
            onAvatarLaunch={onAvatarLaunch}
            session={agentCenterSession}
          />
        ) : null}
      </div>
      </div>
    </main>
  );
}
