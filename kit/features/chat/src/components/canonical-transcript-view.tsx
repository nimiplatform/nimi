import { useCallback, useLayoutEffect, useRef, type ReactNode, type UIEvent } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageAvatarSlot,
  CanonicalMessageContentSlot,
  ConversationCanonicalMessage,
} from '../types.js';
import { TranscriptMessageGroups } from './canonical-transcript-message-groups.js';
import { CanonicalTypingBubble } from './canonical-typing-bubble.js';
import { CANONICAL_STAGE_SURFACE_WIDTH_CLASS } from './canonical-conversation-pane.js';
import type { CanonicalTranscriptDateLabelFormatter } from './canonical-transcript-virtual-items.js';

const TRANSCRIPT_SWITCH_DELTA_THRESHOLD = 300;
const TRANSCRIPT_SWITCH_WINDOW_MS = 600;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 80;
}

export { buildCanonicalTranscriptGroups } from '../headless/transcript-groups.js';

export type CanonicalTranscriptViewProps = {
  messages: readonly ConversationCanonicalMessage[];
  dataTestId?: string;
  activeConversationId?: string | null;
  loading?: boolean;
  error?: string | null;
  pendingFirstBeat?: boolean;
  pendingAgentRoleLabel?: string;
  pendingThinkingLabel?: string;
  pendingStopLabel?: string;
  agentAvatarUrl?: string | null;
  agentName?: string;
  loadingLabel?: string;
  emptyEyebrow?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyStateVariant?: 'default' | 'compact';
  historyIntro?: string | null;
  /** Non-blocking banner rendered above the message list (does not replace messages). */
  bannerContent?: ReactNode;
  content?: ReactNode;
  widthClassName?: string;
  widthPositionClassName?: string;
  scrollViewportWidthClassName?: string;
  scrollViewportPositionClassName?: string;
  contentPaddingBottomClassName?: string;
  onNearBottomChange?: (value: boolean) => void;
  onSeedFirstTurn?: () => void;
  footerContent?: ReactNode;
  renderMessageContent?: CanonicalMessageContentSlot;
  renderMessageAvatar?: CanonicalMessageAvatarSlot;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  formatDateLabel?: CanonicalTranscriptDateLabelFormatter;
  voicePlayingMessageId?: string | null;
  isVoiceTranscriptVisible?: (message: ConversationCanonicalMessage) => boolean;
  disableRpContent?: boolean;
  onPlayVoiceMessage?: (message: ConversationCanonicalMessage) => void;
  onVoiceContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLButtonElement>) => void;
  onMessageContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLDivElement>) => void;
  /** Called when the user scrolls down past the bottom of the transcript, signaling intent to return to stage view. */
  onIntentReturnToStage?: () => void;
  /** Called when the user wants to stop generating (shown inline in the typing bubble). */
  onStopGenerating?: () => void;
};

export function CanonicalTranscriptView({
  messages,
  dataTestId,
  activeConversationId = null,
  loading = false,
  error = null,
  pendingFirstBeat = false,
  pendingAgentRoleLabel = 'Assistant pending',
  pendingThinkingLabel = 'Thinking...',
  pendingStopLabel = 'Stop generating',
  agentAvatarUrl = null,
  agentName = 'Assistant',
  loadingLabel = 'Loading conversation...',
  emptyEyebrow = 'This Moment',
  emptyTitle = 'Start the first turn',
  emptyDescription = 'The transcript stays empty until the first exchange is created.',
  emptyStateVariant = 'default',
  historyIntro = null,
  bannerContent,
  content,
  widthClassName = CANONICAL_STAGE_SURFACE_WIDTH_CLASS,
  widthPositionClassName = 'mx-auto',
  scrollViewportWidthClassName = 'w-full',
  scrollViewportPositionClassName = '',
  contentPaddingBottomClassName = 'pb-6',
  onNearBottomChange,
  onSeedFirstTurn,
  footerContent,
  renderMessageContent,
  renderMessageAvatar,
  renderMessageAccessory,
  formatDateLabel,
  voicePlayingMessageId = null,
  isVoiceTranscriptVisible,
  disableRpContent,
  onPlayVoiceMessage,
  onVoiceContextMenu,
  onMessageContextMenu,
  onIntentReturnToStage,
  onStopGenerating,
}: CanonicalTranscriptViewProps) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const downwardIntentRef = useRef({ distance: 0, lastAt: 0 });
  const nearBottomRef = useRef(true);
  const previousRenderStateRef = useRef<{
    messageCount: number;
    lastMessageId: string | null;
    lastMessageUpdatedAt: string | null;
    pendingFirstBeat: boolean;
    footerVisible: boolean;
  }>({
    messageCount: 0,
    lastMessageId: null,
    lastMessageUpdatedAt: null,
    pendingFirstBeat: false,
    footerVisible: false,
  });
  const showEmptyState = !loading && !error && messages.length === 0 && !content;
  const compactEmptyState = emptyStateVariant === 'compact';
  const lastMessage = messages[messages.length - 1] || null;
  const footerVisible = Boolean(footerContent) && !pendingFirstBeat && !loading && !error;

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextNearBottom = isNearBottom(event.currentTarget);
    nearBottomRef.current = nextNearBottom;
    onNearBottomChange?.(nextNearBottom);
  }, [onNearBottomChange]);

  const handleWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!onIntentReturnToStage) {
      return;
    }
    const now = performance.now();
    const root = scrollRootRef.current;
    const atBottom = root ? isNearBottom(root) : false;
    if (event.deltaY <= 0 || !atBottom) {
      downwardIntentRef.current = { distance: 0, lastAt: now };
      return;
    }
    const previous = downwardIntentRef.current;
    const nextDistance = now - previous.lastAt > TRANSCRIPT_SWITCH_WINDOW_MS
      ? Math.abs(event.deltaY)
      : previous.distance + Math.abs(event.deltaY);
    downwardIntentRef.current = { distance: nextDistance, lastAt: now };
    if (nextDistance >= TRANSCRIPT_SWITCH_DELTA_THRESHOLD) {
      downwardIntentRef.current = { distance: 0, lastAt: now };
      onIntentReturnToStage();
    }
  }, [onIntentReturnToStage]);

  // Auto-scroll to bottom on initial mount (e.g. switching from stage to history)
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    didInitialScrollRef.current = false;
  }, []); // Reset on remount
  useLayoutEffect(() => {
    const root = scrollRootRef.current;
    if (!root) {
      nearBottomRef.current = true;
      onNearBottomChange?.(true);
      return;
    }
    const previousRenderState = previousRenderStateRef.current;
    const transcriptChanged = previousRenderState.messageCount !== messages.length
      || previousRenderState.lastMessageId !== (lastMessage?.id || null)
      || previousRenderState.lastMessageUpdatedAt !== (lastMessage?.updatedAt || null)
      || previousRenderState.pendingFirstBeat !== pendingFirstBeat
      || previousRenderState.footerVisible !== footerVisible;
    if (!didInitialScrollRef.current && messages.length > 0) {
      didInitialScrollRef.current = true;
      root.scrollTop = root.scrollHeight;
    } else if (transcriptChanged && nearBottomRef.current) {
      root.scrollTop = root.scrollHeight;
    }
    const nextNearBottom = isNearBottom(root);
    nearBottomRef.current = nextNearBottom;
    previousRenderStateRef.current = {
      messageCount: messages.length,
      lastMessageId: lastMessage?.id || null,
      lastMessageUpdatedAt: lastMessage?.updatedAt || null,
      pendingFirstBeat,
      footerVisible,
    };
    onNearBottomChange?.(nextNearBottom);
  }, [footerVisible, lastMessage?.id, lastMessage?.updatedAt, loading, messages.length, onNearBottomChange, pendingFirstBeat]);

  return (
    <div className="min-h-0 flex flex-1 overflow-hidden px-6 pt-0">
      <div
        ref={scrollRootRef}
        className={cn(
          'h-full min-h-0 flex-1 overflow-y-auto overscroll-contain',
          scrollViewportPositionClassName,
          scrollViewportWidthClassName,
        )}
        data-testid={dataTestId}
        data-active-chat-id={String(activeConversationId || '')}
        data-canonical-transcript-root="true"
        onScroll={handleScroll}
        onWheelCapture={handleWheelCapture}
        style={{
          overflowAnchor: 'none',
        }}
      >
        <div
          className={cn(widthPositionClassName, 'space-y-5 pt-2', widthClassName, contentPaddingBottomClassName)}
          data-canonical-transcript-width={widthClassName}
        >
        {loading ? (
          <div className="rounded-[30px] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(237,247,247,0.86))] px-6 py-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="h-4 w-28 rounded-full bg-slate-200/80" />
            <div className="mt-4 h-24 w-full rounded-[24px] bg-slate-100/90" />
            <div className="mt-4 h-24 w-full rounded-[24px] bg-slate-100/90" />
            <p className="mt-4 text-sm text-slate-500">{loadingLabel}</p>
          </div>
        ) : null}

        {error ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-[30px] border border-red-200 bg-red-50/70 px-6 py-7 text-center text-sm text-red-600 shadow-[0_20px_52px_rgba(239,68,68,0.08)]">
            {error}
          </div>
        ) : null}

        {!loading && !error && bannerContent ? (
          <div className="sticky top-0 z-10">{bannerContent}</div>
        ) : null}

        {!loading && !error && showEmptyState ? (
          <section
            className={cn(
              'border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(239,247,247,0.88))] shadow-[0_20px_52px_rgba(15,23,42,0.08)]',
              compactEmptyState
                ? 'mr-auto max-w-[620px] rounded-[22px] border-white/65 bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(244,248,248,0.68))] px-5 py-4 text-left shadow-[0_12px_26px_rgba(15,23,42,0.05)]'
                : 'rounded-[30px] px-6 py-7 text-center',
            )}
          >
            <p className={cn(
              'font-semibold uppercase tracking-[0.2em] text-emerald-700/70',
              compactEmptyState ? 'text-[9px]' : 'text-[11px]',
            )}>
              {emptyEyebrow}
            </p>
            <h2 className={cn(
              'mt-3 font-black tracking-tight text-slate-950',
              compactEmptyState ? 'text-[20px]' : 'text-[30px]',
            )}>
              {emptyTitle}
            </h2>
            <p className={cn(
              'mt-3 text-slate-600',
              compactEmptyState ? 'max-w-[520px] text-[14px] leading-6 text-slate-500' : 'mx-auto max-w-xl text-sm leading-7',
            )}>
              {emptyDescription}
            </p>
            {onSeedFirstTurn ? (
              <button
                type="button"
                onClick={onSeedFirstTurn}
                className={cn(
                  'mt-5 inline-flex h-11 items-center rounded-full bg-gradient-to-br from-sky-400 via-cyan-400 to-sky-500 px-5 text-sm font-semibold text-white shadow-[0_18px_36px_color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,transparent)] transition-[box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] hover:shadow-[0_22px_44px_color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,transparent)]',
                  compactEmptyState ? 'self-start' : '',
                )}
              >
                Start the conversation
              </button>
            ) : null}
          </section>
        ) : null}

        {!loading && !error && messages.length > 0 && historyIntro ? (
          <div className="rounded-full border border-white/80 bg-white/72 px-4 py-2 text-center text-[11px] font-medium text-slate-500">
            {historyIntro}
          </div>
        ) : null}

        {!loading && !error && content ? content : null}

        {!loading && !error && !content && messages.length > 0 ? (
          <section>
          <TranscriptMessageGroups
            messages={messages}
            scrollRef={scrollRootRef}
            renderMessageContent={renderMessageContent}
            renderMessageAvatar={renderMessageAvatar}
            renderMessageAccessory={renderMessageAccessory}
            formatDateLabel={formatDateLabel}
            voicePlayingMessageId={voicePlayingMessageId}
            isVoiceTranscriptVisible={isVoiceTranscriptVisible}
              disableRpContent={disableRpContent}
              onPlayVoiceMessage={onPlayVoiceMessage}
              onVoiceContextMenu={onVoiceContextMenu}
              onMessageContextMenu={onMessageContextMenu}
            />
            {pendingFirstBeat ? (
              <div className="py-1">
                <CanonicalTypingBubble
                  agentName={agentName}
                  agentRoleLabel={pendingAgentRoleLabel}
                  thinkingLabel={pendingThinkingLabel}
                  onStop={onStopGenerating}
                  stopLabel={pendingStopLabel}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && !error && !pendingFirstBeat && footerContent ? footerContent : null}
        </div>
      </div>
    </div>
  );
}
