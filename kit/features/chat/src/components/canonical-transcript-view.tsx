import { useCallback, useLayoutEffect, useRef, type ReactNode, type UIEvent } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { resolveChatCopy, type ChatCopy } from '../copy.js';
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
const INITIAL_TRANSCRIPT_PIN_SETTLE_MS = 120;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 80;
}

export { buildCanonicalTranscriptGroups } from '../headless/transcript-groups.js';

export type CanonicalTranscriptViewProps = {
  messages: readonly ConversationCanonicalMessage[];
  /** Copy forwarded to canonical message bubbles. */
  copy?: ChatCopy;
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
  /** Label for the empty-state call-to-action shown when `onSeedFirstTurn` is set. */
  emptyActionLabel?: string;
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
  copy,
  dataTestId,
  activeConversationId = null,
  loading = false,
  error = null,
  pendingFirstBeat = false,
  pendingAgentRoleLabel,
  pendingThinkingLabel,
  pendingStopLabel,
  agentAvatarUrl = null,
  agentName,
  loadingLabel = 'Loading conversation...',
  emptyEyebrow = 'This Moment',
  emptyTitle = 'Start the first turn',
  emptyDescription = 'The transcript stays empty until the first exchange is created.',
  emptyActionLabel = 'Start the conversation',
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
  const copyResolved = resolveChatCopy(copy);
  const resolvedPendingAgentRoleLabel = pendingAgentRoleLabel ?? copyResolved.typingAgentRoleLabel;
  const resolvedPendingThinkingLabel = pendingThinkingLabel ?? copyResolved.typingThinkingLabel;
  const resolvedPendingStopLabel = pendingStopLabel ?? copyResolved.typingStopLabel;
  const resolvedAgentName = agentName ?? copyResolved.bubbleAssistantLabel;
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const contentRootRef = useRef<HTMLDivElement | null>(null);
  const downwardIntentRef = useRef({ distance: 0, lastAt: 0 });
  const nearBottomRef = useRef(true);
  const initialPinRef = useRef(false);
  const initialPinReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const cancelInitialPin = useCallback(() => {
    initialPinRef.current = false;
    if (initialPinReleaseTimerRef.current) {
      clearTimeout(initialPinReleaseTimerRef.current);
      initialPinReleaseTimerRef.current = null;
    }
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextNearBottom = initialPinRef.current || isNearBottom(event.currentTarget);
    nearBottomRef.current = nextNearBottom;
    onNearBottomChange?.(nextNearBottom);
  }, [onNearBottomChange]);

  const handleWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    cancelInitialPin();
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
  }, [cancelInitialPin, onIntentReturnToStage]);

  // Auto-scroll to bottom on initial mount (e.g. switching from stage to history)
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    cancelInitialPin();
    didInitialScrollRef.current = false;
    nearBottomRef.current = true;
    previousRenderStateRef.current = {
      messageCount: 0,
      lastMessageId: null,
      lastMessageUpdatedAt: null,
      pendingFirstBeat: false,
      footerVisible: false,
    };
    return cancelInitialPin;
  }, [activeConversationId, cancelInitialPin]);
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
      initialPinRef.current = true;
      if (initialPinReleaseTimerRef.current) {
        clearTimeout(initialPinReleaseTimerRef.current);
      }
      initialPinReleaseTimerRef.current = setTimeout(() => {
        initialPinRef.current = false;
        initialPinReleaseTimerRef.current = null;
      }, INITIAL_TRANSCRIPT_PIN_SETTLE_MS);
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
  }, [activeConversationId, footerVisible, lastMessage?.id, lastMessage?.updatedAt, loading, messages.length, onNearBottomChange, pendingFirstBeat]);

  useLayoutEffect(() => {
    const root = scrollRootRef.current;
    const contentRoot = contentRootRef.current;
    if (!root || !contentRoot || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      const preservingInitialPin = initialPinRef.current;
      if (!preservingInitialPin && !nearBottomRef.current) {
        return;
      }
      root.scrollTop = root.scrollHeight;
      const nextNearBottom = isNearBottom(root);
      nearBottomRef.current = nextNearBottom;
      onNearBottomChange?.(nextNearBottom);
      if (preservingInitialPin) {
        if (initialPinReleaseTimerRef.current) {
          clearTimeout(initialPinReleaseTimerRef.current);
        }
        initialPinReleaseTimerRef.current = setTimeout(() => {
          if (initialPinRef.current) {
            root.scrollTop = root.scrollHeight;
          }
          initialPinRef.current = false;
          initialPinReleaseTimerRef.current = null;
        }, INITIAL_TRANSCRIPT_PIN_SETTLE_MS);
      }
    });
    observer.observe(contentRoot);
    return () => observer.disconnect();
  }, [onNearBottomChange]);

  return (
    <div className="min-h-0 flex flex-1 overflow-hidden pl-6 pr-2 pt-0">
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
        onPointerDownCapture={cancelInitialPin}
        onWheelCapture={handleWheelCapture}
        style={{
          overflowAnchor: 'none',
        }}
      >
        <div
          ref={contentRootRef}
          className={cn(widthPositionClassName, 'space-y-5 pt-1', widthClassName, contentPaddingBottomClassName)}
          data-canonical-transcript-width={widthClassName}
        >
        {loading ? (
          <div className="rounded-[var(--nimi-radius-xl)] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent)] px-6 py-6 shadow-[var(--nimi-elevation-floating)]">
            <div className="h-4 w-28 animate-pulse rounded-full bg-[var(--nimi-surface-active)]" />
            <div className="mt-4 h-24 w-full animate-pulse rounded-[var(--nimi-radius-xl)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)]" />
            <div className="mt-4 h-24 w-full animate-pulse rounded-[var(--nimi-radius-xl)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)]" />
            <p className="mt-4 text-sm text-[var(--nimi-text-muted)]">{loadingLabel}</p>
          </div>
        ) : null}

        {error ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-[var(--nimi-radius-xl)] border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] px-6 py-7 text-center text-sm text-[var(--nimi-status-danger)] shadow-[0_20px_52px_color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)]">
            {error}
          </div>
        ) : null}

        {!loading && !error && bannerContent ? (
          <div className="sticky top-0 z-10">{bannerContent}</div>
        ) : null}

        {!loading && !error && showEmptyState ? (
          <section
            className={cn(
              'border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent)] shadow-[var(--nimi-elevation-floating)]',
              compactEmptyState
                ? 'mr-auto max-w-[620px] rounded-[var(--nimi-radius-xl)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-5 py-4 text-left shadow-[var(--nimi-elevation-raised)]'
                : 'rounded-[var(--nimi-radius-xl)] px-6 py-7 text-center',
            )}
          >
            <p className={cn(
              'font-semibold uppercase tracking-[0.2em] text-[var(--nimi-action-primary-bg)]/70',
              'text-[length:var(--nimi-type-overline-size)]',
            )}>
              {emptyEyebrow}
            </p>
            <h2 className={cn(
              'mt-3 font-black tracking-tight text-[var(--nimi-text-primary)]',
              compactEmptyState ? 'text-[length:var(--nimi-type-page-title-size)]' : 'text-[length:var(--nimi-type-hero-title-size)]',
            )}>
              {emptyTitle}
            </h2>
            <p className={cn(
              'mt-3 text-[var(--nimi-text-secondary)]',
              compactEmptyState ? 'max-w-[520px] text-[length:var(--nimi-type-body-size)] leading-6 text-[var(--nimi-text-muted)]' : 'mx-auto max-w-xl text-sm leading-7',
            )}>
              {emptyDescription}
            </p>
            {onSeedFirstTurn ? (
              <button
                type="button"
                onClick={onSeedFirstTurn}
                className={cn(
                  'mt-5 inline-flex h-11 items-center rounded-full bg-[var(--nimi-action-primary-bg)] px-5 text-sm font-semibold text-[var(--nimi-action-primary-text)] shadow-[0_18px_36px_color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,transparent)] transition-[box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] hover:bg-[var(--nimi-action-primary-bg-hover)] hover:shadow-[0_22px_44px_color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,transparent)]',
                  compactEmptyState ? 'self-start' : '',
                )}
              >
                {emptyActionLabel}
              </button>
            ) : null}
          </section>
        ) : null}

        {!loading && !error && messages.length > 0 && historyIntro ? (
          <div className="rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-4 py-2 text-center text-[length:var(--nimi-type-overline-size)] font-medium text-[var(--nimi-text-muted)]">
            {historyIntro}
          </div>
        ) : null}

        {!loading && !error && content ? content : null}

        {!loading && !error && !content && messages.length > 0 ? (
          <section>
          <TranscriptMessageGroups
            messages={messages}
            scrollRef={scrollRootRef}
            copy={copy}
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
                  agentName={resolvedAgentName}
                  agentRoleLabel={resolvedPendingAgentRoleLabel}
                  thinkingLabel={resolvedPendingThinkingLabel}
                  onStop={onStopGenerating}
                  stopLabel={resolvedPendingStopLabel}
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
