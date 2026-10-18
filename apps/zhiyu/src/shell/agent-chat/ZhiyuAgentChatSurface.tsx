import { useNimiNavigationSnapshot } from '@nimiplatform/kit/ui/app-chrome';
import { useZhiyuNavigationOwner, type ZhiyuDestination } from '../app/navigation.js';
import { AgentIntroduction } from '@nimiplatform/kit/features/chat/ui';
import { useAgentIntroduction } from '@nimiplatform/kit/features/chat/runtime';
import type { NimiLocalAppAgentIntroductionClient } from '@nimiplatform/sdk/app';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';
import {
  nimiToast,
  StatusBadge,
} from '@nimiplatform/kit/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createBrowserDataUrlAttachmentAdapter,
  type BrowserDataUrlAttachment,
  type ChatComposerAdapter,
  type AgentDraftSaveStatus,
} from '@nimiplatform/kit/features/chat/headless';
import {
  LocalAppConversationVoiceButton,
  LocalAppConversationSubmissionRecovery,
  LocalAppConversationFollowUpControl,
  LocalAppConversationMediaStopButton,
  CanonicalComposer,
  CanonicalTranscriptView,
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/ui';
import {
	AlertTriangle,
  ChevronRight,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuDesktopOpenActionResult } from '../desktop-open/desktop-open-action';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { ZhiyuRuntimeAgentChatAttachment } from './agent-conversation-state';
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
  currentTurnAssistantText,
  formatZhiyuTranscriptDateLabel,
} from './ZhiyuAgentChatLabels';
import {
  ComposerAgentCenterButton,
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
import { runZhiyuVoiceTranscriptionAttempt } from './voice-transcription-guard';
import { isZhiyuAgentBusyReason, isZhiyuRecoverableTerminalTurn } from '../app/direct-local-app-submit-gate';
import { zhiyuConversationActionKey } from './agent-conversation-state';
import { ZhiyuResourcePackSurface } from '../../resource-pack/ZhiyuResourcePackSurface';
import { ZhiyuResourcePackStatusNotice } from '../../resource-pack/ZhiyuResourcePackStatusNotice';
import type { ZhiyuResourcePackPresentationState } from '../../resource-pack/presentation-controller';
import { ZhiyuAgentActivityReferences } from './ZhiyuAgentActivityReferences';

export type ZhiyuAgentChatSurfaceProps = {
  readonly evidence: ZhiyuEvidence;
  readonly product: ZhiyuHomeProductState;
  readonly draft: string;
  readonly submitEnabled: boolean;
  readonly submitting: boolean;
  readonly composerState: string;
  readonly draftSaveStatus: AgentDraftSaveStatus;
  readonly onRetryDraftSave: () => void;
  readonly interactionNotice: string | null;
  readonly connectionStatus: 'loading' | 'ready' | 'error';
  readonly pendingSubmission: import('@nimiplatform/kit/features/chat/headless').AgentPendingSubmission | null;
  readonly onAcknowledgeSubmission: (requestId: string) => Promise<void>;
  readonly onRestoreSubmission: (text: string) => void;
  readonly onSubmissionResolved: () => void;
  readonly onRefreshConversation: () => void;
  readonly onRegenerate: () => void;
  readonly conversation: () => import('@nimiplatform/sdk/app').NimiLocalAppConversationClient;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly agentCenterSession: AgentCenterSession | null;
  readonly resourcePackPresentation: ZhiyuResourcePackPresentationState;
  readonly resourcePackPlacementKey: string | null;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: (text: string, attachment?: ZhiyuRuntimeAgentChatAttachment) => Promise<void> | void;
  readonly onTranscribeVoice?: (audioBytes: Uint8Array, mimeType: string, signal: AbortSignal) => Promise<string>;
  readonly onStopChat: () => void;
  readonly onSelectLocalAgent: (agentHandle: NimiLocalAppAgentHandle) => void;
  readonly onDesktopOpenRuntimeSettings: () => Promise<void> | void;
  readonly onRetryAgentCenter: () => void;
  readonly onResourcePackPlacementReady: (requestId: string) => void;
  readonly onDesktopOpenSelectPartner: () => Promise<ZhiyuDesktopOpenActionResult> | ZhiyuDesktopOpenActionResult;
  readonly onAvatarLaunch?: () => void;
  readonly onAvatarManage?: () => void;
};

export function ZhiyuAgentChatSurface({
  evidence,
  product,
  draft,
  submitEnabled,
  submitting,
  draftSaveStatus,
  onRetryDraftSave,
  composerState, interactionNotice, connectionStatus, pendingSubmission, onAcknowledgeSubmission, onRestoreSubmission, onSubmissionResolved, onRefreshConversation, onRegenerate, conversation,
  avatarLaunchAction,
  agentCenterSession,
  resourcePackPresentation,
  resourcePackPlacementKey,
  onDraftChange,
  onSubmit,
  onTranscribeVoice,
  onStopChat,
  onSelectLocalAgent,
  onDesktopOpenRuntimeSettings,
  onRetryAgentCenter,
  onResourcePackPlacementReady,
  onDesktopOpenSelectPartner,
  onAvatarLaunch,
}: ZhiyuAgentChatSurfaceProps) {
  const { navigation, sidebarVisible } = useZhiyuNavigationOwner();
  const destination = useNimiNavigationSnapshot<ZhiyuDestination>().current.destination;
  const openPanel = (panel?: AgentPanelTab) => { const current = navigation.getSnapshot().current.destination; void navigation.push({ ...current, panel }); };
  const currentPartnerName = currentPartnerDisplayName(evidence);
  const currentPartnerAvatar = currentPartnerAvatarUrl(evidence);
  const hasCurrentPartner = evidence.localAgent.ready;
  const hasLocalPartners = evidence.inventory.localAgents.length > 0;
  const primaryPartnerName = hasCurrentPartner ? '当前伙伴' : currentPartnerName;
  const readIntroduction = useCallback<NimiLocalAppAgentIntroductionClient['getIntroduction']>(request => getZhiyuLocalAppClient().agents.getIntroduction(request), []);
  const { introduction, unavailable: introductionUnavailable, retry: retryIntroduction } = useAgentIntroduction({ agentHandle: hasCurrentPartner ? evidence.localAgent.agentHandle : null, getIntroduction: readIntroduction });
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
      ? '如果想添加更多伙伴，请到 Nimi Home 的「探索」中选择角色。'
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
        <p className="zhiyu-no-local-partner-empty__copy">
          {evidence.inventory.ready ? emptyDescription : evidence.inventory.message}
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
  const recoverableTerminalTurn = isZhiyuRecoverableTerminalTurn(evidence);
  const chatDisabled = !evidence.conversation.ready
    || (!evidence.turn.ready && !recoverableTerminalTurn)
    || Boolean(evidence.chat.textTurnId) || connectionStatus !== 'ready' || submitting || Boolean(pendingSubmission);
  const composerKey = `${evidence.conversation.agentHandle ?? ''}|${evidence.conversation.conversationAnchorId ?? ''}`;
  const [attachmentDrafts, setAttachmentDrafts] = useState(() => new Map<string, readonly BrowserDataUrlAttachment[]>());
  const attachments = attachmentDrafts.get(composerKey) ?? [];
  const setAttachments = (next: readonly BrowserDataUrlAttachment[]) => setAttachmentDrafts(current => {
    const drafts = new Map(current);
    if (next.length) drafts.set(composerKey, next);
    else drafts.delete(composerKey);
    return drafts;
  });
  const attachmentAdapter = useMemo(() => createBrowserDataUrlAttachmentAdapter({
    accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    maxAttachments: 1,
    idPrefix: 'zhiyu-conversation-image',
  }), []);
  const chatComposerAdapter: ChatComposerAdapter<BrowserDataUrlAttachment> = {
    submit: async (input) => {
      const attachment = input.attachments[0]
        ? await browserAttachmentPayload(input.attachments[0])
        : undefined;
      await onSubmit(input.text, attachment);
    },
  };
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'transcribing' | 'failed'>('idle');
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceCanceledRef = useRef(false);
  const voiceTranscriptionAbortRef = useRef<AbortController | null>(null);
  const voiceGenerationRef = useRef(0);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearVoiceCapture = useCallback(() => {
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    voiceTimerRef.current = null;
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    voiceRecorderRef.current = null;
  }, []);
  const cancelVoiceCapture = useCallback(() => {
    voiceCanceledRef.current = true;
    voiceGenerationRef.current += 1;
    voiceTranscriptionAbortRef.current?.abort('zhiyu_voice_transcription_canceled');
    voiceTranscriptionAbortRef.current = null;
    const recorder = voiceRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else clearVoiceCapture();
    setVoiceStatus('idle');
  }, [clearVoiceCapture]);
  const toggleVoiceCapture = useCallback(() => {
    const active = voiceRecorderRef.current;
    if (active && active.state === 'recording') {
      active.stop();
      return;
    }
    if (!onTranscribeVoice || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;
    voiceCanceledRef.current = false;
    voiceChunksRef.current = [];
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : '';
      const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined);
      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const canceled = voiceCanceledRef.current;
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || preferredMime || 'audio/webm' });
        voiceChunksRef.current = [];
        clearVoiceCapture();
        if (canceled) return;
		const generation = voiceGenerationRef.current + 1;
		voiceGenerationRef.current = generation;
		const transcriptionAbort = new AbortController();
		voiceTranscriptionAbortRef.current = transcriptionAbort;
        setVoiceStatus('transcribing');
        void blob.arrayBuffer()
			.then((buffer) => runZhiyuVoiceTranscriptionAttempt({
				audioBytes: new Uint8Array(buffer),
				mimeType: blob.type || 'audio/webm',
				signal: transcriptionAbort.signal,
				isCurrent: () => voiceGenerationRef.current === generation,
				transcribe: onTranscribeVoice,
				submit: onSubmit,
			}))
			.then(() => {
				if (voiceGenerationRef.current === generation) setVoiceStatus('idle');
			})
			.catch(() => {
				if (!transcriptionAbort.signal.aborted && voiceGenerationRef.current === generation) setVoiceStatus('failed');
			})
			.finally(() => {
				if (voiceTranscriptionAbortRef.current === transcriptionAbort) voiceTranscriptionAbortRef.current = null;
			});
      }, { once: true });
      recorder.start();
      setVoiceStatus('recording');
      voiceTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 5 * 60 * 1_000);
    }).catch(() => setVoiceStatus('failed'));
  }, [clearVoiceCapture, onSubmit, onTranscribeVoice]);
  useEffect(() => () => {
    voiceCanceledRef.current = true;
    voiceGenerationRef.current += 1;
    voiceTranscriptionAbortRef.current?.abort('zhiyu_voice_surface_unmounted');
    voiceTranscriptionAbortRef.current = null;
    const recorder = voiceRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearVoiceCapture();
  }, [clearVoiceCapture]);
  useEffect(() => {
	voiceGenerationRef.current += 1;
	voiceTranscriptionAbortRef.current?.abort('zhiyu_voice_conversation_changed');
	voiceTranscriptionAbortRef.current = null;
  }, [evidence.conversation.agentHandle, evidence.conversation.conversationAnchorId]);
  const voiceState = onTranscribeVoice
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined'
    ? { status: voiceStatus, onToggle: toggleVoiceCapture, onCancel: cancelVoiceCapture }
    : undefined;
  const chatRuntimeHint = isZhiyuAgentBusyReason(evidence.chat.reasonCode)
    ? '伙伴正在处理另一项请求。输入已保留，请稍后重试。'
    : chatDisabled && (hasCurrentPartner || evidence.chat.state === 'streaming')
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
        partialText="正在回复…"
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
  // Turn outcome notices end the transcript like the streaming footer. The
  // composer floats over the canvas bottom, so anything placed below the
  // transcript would sit hidden under it.
  const chatTurnNotices = (
    <>
      {interactionNotice ? <p role="status">{interactionNotice}</p> : null}
      {draftSaveStatus === 'unsaved' ? <p role="status">草稿尚未保存，输入仍在。离开前请重试保存或复制文字。 <button type="button" onClick={onRetryDraftSave}>重试保存</button></p> : null}
      {connectionStatus === 'error' ? <div role="status">连接暂时中断，已有内容已保留。<button type="button" onClick={onRefreshConversation}>重新连接</button></div> : null}
      {pendingSubmission && !submitting && evidence.conversation.agentHandle ? <LocalAppConversationSubmissionRecovery
        submission={pendingSubmission} agentHandle={evidence.conversation.agentHandle} conversation={conversation}
        acknowledge={onAcknowledgeSubmission} onRestore={onRestoreSubmission} onResolved={onSubmissionResolved} translate={submissionCopy} /> : null}
      {evidence.chat.regenerateTurnId && !pendingSubmission ? <button type="button" disabled={submitting} onClick={onRegenerate}>重新回答原问题</button> : null}
      {evidence.chat.state === 'failed' ? (
        <RuntimeChatFailureNotice chat={evidence.chat} onOpenSettings={onDesktopOpenRuntimeSettings}
          onReopen={evidence.localAgent.agentHandle ? () => onSelectLocalAgent(evidence.localAgent.agentHandle!) : undefined} />
      ) : null}
      {evidence.chat.actionHint === 'reselect_local_partner' ? (
        <section
          className="zhiyu-home__chat-failure-notice"
          data-zhiyu-agent-chat-recovery="reselect-local-partner"
          data-zhiyu-agent-chat-turn-admission={
            evidence.chat.diagnostics?.turnAdmission === 'observed' ? 'observed' : 'not-observed'
          }
          aria-live="polite"
          aria-label="伙伴会话需要刷新"
        >
          <div className="zhiyu-home__chat-failure-mark" aria-hidden="true">
            <AlertTriangle size={17} />
          </div>
          <div className="zhiyu-home__chat-failure-copy">
            <span>
              {evidence.chat.diagnostics?.turnAdmission === 'observed'
                ? '伙伴会话已更新'
                : '伙伴会话已失效'}
            </span>
            <strong>请重新选择当前伙伴</strong>
            <p>
              {evidence.chat.diagnostics?.turnAdmission === 'observed'
                ? 'Runtime 已接受此 turn；重新选择后会读取当前结果。'
                : '这条消息尚未确认提交到 Runtime；重新选择后草稿会保留，可再次发送。'}
            </p>
          </div>
        </section>
      ) : null}

    </>
  );
  const rightPanelMode: RightPanelMode = destination.panel ? 'agent' : 'closed';
  const activeAgentTab: AgentPanelTab = destination.panel ?? 'overview';
  const acknowledgedPlacementKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!resourcePackPlacementKey) return;
    acknowledgedPlacementKeyRef.current = null;
    openPanel('appearance');
  }, [resourcePackPlacementKey]);
  useLayoutEffect(() => {
    if (!resourcePackPlacementKey
      || rightPanelMode !== 'agent'
      || activeAgentTab !== 'appearance'
      || acknowledgedPlacementKeyRef.current === resourcePackPlacementKey) {
      return;
    }
    acknowledgedPlacementKeyRef.current = resourcePackPlacementKey;
    onResourcePackPlacementReady(resourcePackPlacementKey);
  }, [
    activeAgentTab,
    onResourcePackPlacementReady,
    resourcePackPlacementKey,
    rightPanelMode,
  ]);
  const composerRootRef = useRef<HTMLDivElement>(null);
  const openAppearanceConfig = () => {
    openPanel('appearance');
  };
  const openBehaviorConfig = () => {
    openPanel('behavior');
  };
  const openAgentOverview = () => {
    openPanel('overview');
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
        data-zhiyu-rail-visible={sidebarVisible && hasLocalPartners}
        data-zhiyu-relationship-rail-state={hasLocalPartners ? 'available' : 'empty'}
      >
        {sidebarVisible && hasLocalPartners ? <DesktopPresenceRail
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
            openPanel('overview');
          }}
          onSelectAgent={(agentHandle) => {
            onSelectLocalAgent(agentHandle);
          }}
        /> : null}

        <ZhiyuResourcePackSurface
          className="zhiyu-chat-canvas"
          effectiveSource={resourcePackPresentation.effectiveSource}
          phase={resourcePackPresentation.phase}
          scopedCssText={resourcePackPresentation.scopedCssText}
          data-zhiyu-region="conversation"
        >
          <ZhiyuResourcePackStatusNotice state={resourcePackPresentation} />
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
            <div className="zhiyu-chat-canvas__transcript">
              <CanonicalTranscriptView
                copy={{ bubbleVoiceMessageLabel: '语音消息', bubbleVoicePlayingLabel: '正在播放' }}
                messages={conversationMessagesForDisplay(evidence.chat.messages, primaryPartnerName)}
                activeConversationId={evidence.conversation.conversationAnchorId}
                agentName={primaryPartnerName}
                formatDateLabel={formatZhiyuTranscriptDateLabel}
                emptyEyebrow={hasCurrentPartner ? '' : 'ZHIYU'}
                emptyTitle={hasCurrentPartner ? '' : emptyTitle}
                emptyDescription={hasCurrentPartner ? '' : emptyDescription}
                emptyStateContent={hasCurrentPartner ? <AgentIntroduction key={evidence.localAgent.agentHandle} introduction={introduction} imageMaxSize="clamp(180px, calc(100dvh - 630px), 420px)" unavailable={introductionUnavailable} onRetry={retryIntroduction} displayName={currentPartnerName} avatarUrl={currentPartnerAvatar} locale="zh-CN" questionsEnabled={!chatDisabled} onPrefill={onDraftChange} /> : undefined}
                content={noLocalPartnerEmptyState}
                footerContent={(
                  <>
                    {chatTurnNotices}
                    {evidence.chat.controlState && evidence.conversation.agentHandle && evidence.conversation.conversationAnchorId ? <LocalAppConversationFollowUpControl
                      agentHandle={evidence.conversation.agentHandle} conversationAnchorId={evidence.conversation.conversationAnchorId}
                      state={evidence.chat.controlState} conversation={conversation} refresh={onRefreshConversation} translate={followUpCopy} /> : null}
                    {chatFooter}
                    <ZhiyuAgentActivityReferences agentHandle={evidence.conversation.agentHandle} />
                    <span
                      data-zhiyu-transcript-end="true"
                      aria-hidden="true"
                      className="block h-px w-full"
                    />
                  </>
                )}
                widthClassName="w-full max-w-none"
                widthPositionClassName="mx-0"
                scrollViewportWidthClassName="w-full"
                contentPaddingBottomClassName={hasCurrentPartner && evidence.chat.messageCount === 0 ? 'pb-[120px]' : 'pb-[clamp(160px,18vh,220px)]'}
                disableRpContent
                renderMessageAccessory={(message) => <>
                  {message.metadata?.canonicalPartial && message.status !== 'streaming'
                    ? <p className="text-xs text-neutral-500">{message.status === 'canceled' ? message.text.trim() ? '已停止，保留已收到的内容。' : '已停止。' : message.text.trim() ? '回复未完成，已收到的内容已保留。' : '这次未收到回复，可以重新回答原问题。'}</p>
                    : message.metadata?.canonicalMediaRunning ? <p className="text-xs text-neutral-500">文字已完成，媒体仍在处理。可以继续聊天。</p> : null}
                  {message.metadata?.canonicalMediaRunning && (message.role === 'agent' || message.role === 'assistant') && evidence.conversation.agentHandle && evidence.conversation.conversationAnchorId ? <LocalAppConversationMediaStopButton
                    agentHandle={evidence.conversation.agentHandle} conversationAnchorId={evidence.conversation.conversationAnchorId}
                    turnId={String(message.metadata.canonicalTurnId)} conversation={conversation}
                    label="停止生成媒体" errorLabel="尚未确认停止结果。文字回复已保留，可以继续聊天。" /> : null}
                  {Array.isArray(message.metadata?.canonicalImageFailures) && message.kind === 'text' && (message.role === 'agent' || message.role === 'assistant') ? message.metadata.canonicalImageFailures.map((failure: { actionId: string; reasonCode: string | null; message: string | null }) =>
                    <div key={failure.actionId} className="my-2 text-sm" role="status"><p>图片暂未生成，文字回复已保留，可以继续聊天。</p><details className="text-xs"><summary>技术详情</summary>{failure.reasonCode}{failure.message ? ` · ${failure.message}` : ''}</details></div>) : null}
                  <LocalAppConversationVoiceButton message={message} agentHandle={evidence.conversation.agentHandle}
                    activeConversationAnchorId={evidence.conversation.conversationAnchorId} conversation={conversation}
                    playLabel="播放语音" stopLabel="停止播放" renderingLabel="正在准备语音" unavailableLabel="语音暂不可用，文字已保留。"
                    errorLabel="语音播放失败，文字已保留。" retryLabel="重试语音" pauseLabel="暂停" resumeLabel="继续播放" progressLabel="播放进度"
                    settingsLabel="语音设置" settingsHint="可在伙伴中心检查语音设置。" onOpenSettings={openAppearanceConfig} />
                </>}

              />
            </div>
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
                key={composerKey}
                adapter={chatComposerAdapter}
                attachmentAdapter={attachmentAdapter}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                attachLabel="添加图片"
                voiceState={voiceState}
                text={draft}
                onTextChange={onDraftChange}
                disabled={chatDisabled}
                placeholder={hasCurrentPartner ? '和这个伙伴聊点什么...' : hasLocalPartners ? '先选择本地伙伴...' : '添加本地伙伴后开始聊天...'}
                runtimeHint={chatRuntimeHint}
                sendHint={evidence.chat.state === 'streaming' ? '回复中' : isZhiyuAgentBusyReason(evidence.chat.reasonCode) ? '重试' : undefined}
                layout="stacked"
                leadingSlot={(
                  <ComposerAvatarButton
                    currentPartnerName={currentPartnerName}
                    currentPartnerAvatarUrl={currentPartnerAvatar}
                    hasCurrentPartner={hasCurrentPartner}
                    onOpenSettings={openAppearanceConfig}
                  />
                )}
                toolbarSlot={(
                  <ComposerModeTools
                    avatarLaunchAction={avatarLaunchAction}
                    onAvatarLaunch={onAvatarLaunch}
                    onOpenAppearance={openAppearanceConfig}
                    onOpenBehavior={openBehaviorConfig}
                  />
                )}
                trailingSlot={(
                  <ComposerAgentCenterButton
                    open={rightPanelMode === 'agent'}
                    onToggleAgentPanel={() => {
                      if (rightPanelMode === 'agent') {
                        openPanel();
                        return;
                      }
                      openPanel('overview');
                    }}
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
        </ZhiyuResourcePackSurface>

        {rightPanelMode !== 'closed' ? (
          <RightAgentPanel
            mode={rightPanelMode}
            evidence={evidence}
            currentPartnerName={currentPartnerName}
            activeTab={activeAgentTab}
            onActiveTabChange={openPanel}
            onClose={() => openPanel()}
            onOpenDesktopRuntimeSettings={() => { void onDesktopOpenRuntimeSettings(); }}
            onRetryAgentCenter={onRetryAgentCenter}
            onAvatarLaunch={onAvatarLaunch}
            session={agentCenterSession}
          />
        ) : null}
      </div>
      </div>
    </main>
  );
}

async function browserAttachmentPayload(
  attachment: BrowserDataUrlAttachment,
): Promise<ZhiyuRuntimeAgentChatAttachment> {
  const response = await fetch(attachment.dataUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.mimeType)) {
    throw new Error('Unsupported conversation image MIME.');
  }
  return {
    bytes,
    mimeType: attachment.mimeType as ZhiyuRuntimeAgentChatAttachment['mimeType'],
    displayName: attachment.name,
  };
}

function followUpCopy(key: string, values?: Record<string, string | number>): string {
  const copy: Record<string, string> = {
    'Chat.followUpTitle': '伙伴续聊', 'Chat.followUpDescription': '允许伙伴在本次对话中安排后续回复。默认关闭，不影响主动活动设置。',
    'Chat.followUpEnabled': '允许续聊', 'Chat.followUpLimit': `每次最多连续 ${values?.count ?? ''} 轮`,
    'Chat.followUpPending': `已安排在 ${values?.time ?? ''} 回复`, 'Chat.followUpCancel': '取消这次续聊',
    'Chat.followUpNewTime': '新的回复时间', 'Chat.followUpReschedule': '改期', 'Chat.followUpNone': '没有等待中的续聊。',
    'Chat.followUpStartedNotice': '已经开始的回复请使用停止回复。', 'Chat.followUpUnavailable': '续聊状态暂不可用。',
    'Chat.followUpChanged': '未能更新，请刷新后再试。', 'Chat.followUpRefresh': '刷新状态',
  };
  return copy[key] ?? key;
}

function submissionCopy(key: string, values?: Record<string, string | number>): string {
  const copy: Record<string, string> = {
    'Chat.agentSubmissionRetryPending': '重新回答的受理结果尚未确认。', 'Chat.agentSubmissionPending': '上一条消息的受理结果尚未确认。',
    'Chat.agentSubmissionRecoverNotice': '原内容已保留。继续会确认同一条消息，不会自动重新生成。',
    'Chat.agentSubmissionAttachments': `已保留 ${values?.count ?? ''} 个附件。`, 'Chat.agentSubmissionUnknown': '目前还无法确认是否受理，可继续确认同一条消息。',
    'Chat.agentSubmissionCheckFailed': '暂时无法确认，请稍后重试。', 'Feedback.technicalDetails': '技术详情',
    'Chat.agentSubmissionWorking': '正在确认…', 'Chat.agentSubmissionRetryRecover': '继续这次重新回答', 'Chat.agentSubmissionRecover': '继续这条消息',
    'Chat.agentSubmissionOtherOptions': '其他选项', 'Chat.agentSubmissionCheck': '只查看对话', 'Chat.agentSubmissionKeepAsDraft': '取回文字作为草稿',
    'Chat.agentSubmissionDismiss': '关闭提示', 'Chat.agentSubmissionDraftNotice': '取回文字不会停止可能已受理的回复。再次发送会成为一条新消息。',
  };
  return copy[key] ?? key;
}
