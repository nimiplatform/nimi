import { useCallback, useLayoutEffect, useRef, type ReactNode, type UIEvent } from 'react';
import { Avatar, cn } from '@nimiplatform/kit/ui';
import { resolveChatCopy, type ChatCopy } from '../copy.js';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageAvatarSlot,
  CanonicalMessageContentSlot,
  ConversationCanonicalMessage,
} from '../types.js';
import { TranscriptMessageGroups, type CanonicalTranscriptScrollMechanics } from './canonical-transcript-message-groups.js';
import { CanonicalTypingBubble } from './canonical-typing-bubble.js';
import { CANONICAL_STAGE_SURFACE_WIDTH_CLASS } from './canonical-conversation-pane.js';
import type { CanonicalTranscriptDateLabelFormatter } from './canonical-transcript-virtual-items.js';
import { CanonicalMessageActionsProvider, type CanonicalMessageActions } from './canonical-message-actions.js';
import type { ConversationPositionRequest, ConversationReadPosition } from '../runtime/local-app-conversation-history.js';

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
  /** Recovery control rendered under `error`, such as a retry button. */
  errorAction?: ReactNode;
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
  /** Agent identity (avatar + display name) shown in the empty state above the title; replaces `emptyEyebrow` when set. */
  emptyStateAgent?: {
    displayName: string;
    avatarUrl?: string | null;
  } | null;
  /** Label for the empty-state call-to-action shown when `onSeedFirstTurn` is set. */
  emptyActionLabel?: string;
  /** Content rendered inside the empty state below the copy (e.g. a centered composer). */
  emptyStateContent?: ReactNode;
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
  /** Measured floating composer clearance; omitted hosts keep their class-based spacing. */
  contentBottomInsetPx?: number;
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
  messageActions?: CanonicalMessageActions;
  positionRequest?: ConversationPositionRequest | null;
  onPositionChange?: (position: ConversationReadPosition) => void;
  onUserNavigate?: () => void;
};

export function CanonicalTranscriptView({
  messages,
  copy,
  dataTestId,
  activeConversationId = null,
  loading = false,
  error = null,
  errorAction = null,
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
  emptyStateAgent = null,
  emptyActionLabel = 'Start the conversation',
  emptyStateContent,
  emptyStateVariant = 'default',
  historyIntro = null,
  bannerContent,
  content,
  widthClassName = CANONICAL_STAGE_SURFACE_WIDTH_CLASS,
  widthPositionClassName = 'mx-auto',
  scrollViewportWidthClassName = 'w-full',
  scrollViewportPositionClassName = '',
  contentPaddingBottomClassName = 'pb-6',
  contentBottomInsetPx,
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
  messageActions,
  positionRequest,
  onPositionChange,
  onUserNavigate,
}: CanonicalTranscriptViewProps) {
  const copyResolved = resolveChatCopy(copy);
  const resolvedPendingAgentRoleLabel = pendingAgentRoleLabel ?? copyResolved.typingAgentRoleLabel;
  const resolvedPendingThinkingLabel = pendingThinkingLabel ?? copyResolved.typingThinkingLabel;
  const resolvedPendingStopLabel = pendingStopLabel ?? copyResolved.typingStopLabel;
  const resolvedAgentName = agentName ?? copyResolved.bubbleAssistantLabel;
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const contentRootRef = useRef<HTMLDivElement | null>(null);
  const scrollMechanicsRef = useRef<CanonicalTranscriptScrollMechanics | null>(null);
  const downwardIntentRef = useRef({ distance: 0, lastAt: 0 });
  const nearBottomRef = useRef(true);
  const readingPositionRef = useRef<ConversationReadPosition | null>(null);
  const lastScrollHeightRef = useRef(0);
  const initialPinRef = useRef(false);
  const initialPinReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRenderStateRef = useRef<{
    messageCount: number;
    lastMessageId: string | null;
    lastMessageUpdatedAt: string | null;
    pendingFirstBeat: boolean;
    footerVisible: boolean;
    bottomInsetPx: number | undefined;
  }>({
    messageCount: 0,
    lastMessageId: null,
    lastMessageUpdatedAt: null,
    pendingFirstBeat: false,
    footerVisible: false,
    bottomInsetPx: undefined,
  });
  const showEmptyState = !loading && !error && messages.length === 0 && !content;
  const compactEmptyState = emptyStateVariant === 'compact';
  // Hosts that draw their own empty-state heading (e.g. a character hero) blank
  // every copy prop; the copy gap then only pushes a viewport-sized empty state
  // into scrolling.
  const hasEmptyStateCopy = Boolean(emptyStateAgent || emptyEyebrow || emptyTitle || emptyDescription || onSeedFirstTurn);
  const lastMessage = messages[messages.length - 1] || null;
  const footerVisible = Boolean(footerContent) && !pendingFirstBeat && !loading && !error;

  const cancelInitialPin = useCallback(() => {
    scrollMechanicsRef.current?.cancel();
    initialPinRef.current = false;
    if (initialPinReleaseTimerRef.current) {
      clearTimeout(initialPinReleaseTimerRef.current);
      initialPinReleaseTimerRef.current = null;
    }
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const contentResized = root.scrollHeight !== lastScrollHeightRef.current;
    lastScrollHeightRef.current = root.scrollHeight;
    // A measured message or voice accessory can grow before ResizeObserver
    // runs. Its scroll event must not release an existing bottom follow.
    const nextNearBottom = initialPinRef.current
      || (contentResized ? nearBottomRef.current : isNearBottom(root));
    nearBottomRef.current = nextNearBottom;
    onNearBottomChange?.(nextNearBottom);
    const viewport = root.getBoundingClientRect();
    const row = Array.from(root.querySelectorAll<HTMLElement>('[data-canonical-message-id]')).find(item => { const bounds = item.getBoundingClientRect(); return bounds.bottom > viewport.top && bounds.top < viewport.bottom; });
    if (row?.dataset.canonicalMessageId) {
      const position = { messageId: row.dataset.canonicalMessageId, offset: viewport.top - row.getBoundingClientRect().top };
      readingPositionRef.current = position; onPositionChange?.(position);
    }
  }, [onNearBottomChange, onPositionChange]);

  const handleWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    onUserNavigate?.();
    cancelInitialPin();
    if (event.deltaY < 0) nearBottomRef.current = false;
    else if (scrollRootRef.current && isNearBottom(scrollRootRef.current)) nearBottomRef.current = true;
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
  }, [cancelInitialPin, onIntentReturnToStage, onUserNavigate]);
  // Auto-scroll to bottom on initial mount (e.g. switching from stage to history)
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    cancelInitialPin();
    didInitialScrollRef.current = false;
    if (scrollRootRef.current) scrollRootRef.current.scrollTop = 0;
    nearBottomRef.current = true;
    lastScrollHeightRef.current = scrollRootRef.current?.scrollHeight ?? 0;
    previousRenderStateRef.current = {
      messageCount: 0,
      lastMessageId: null,
      lastMessageUpdatedAt: null,
      pendingFirstBeat: false,
      footerVisible: false,
      bottomInsetPx: undefined,
    };
    readingPositionRef.current = null;
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
      || previousRenderState.footerVisible !== footerVisible
      || previousRenderState.bottomInsetPx !== contentBottomInsetPx;
    // Sending a message is an explicit request to see it: jump to the bottom
    // even when the person had scrolled up to read history.
    const ownMessageAppended = messages.length > previousRenderState.messageCount
      && lastMessage !== null
      && previousRenderState.lastMessageId !== lastMessage.id
      && (lastMessage.role === 'user' || lastMessage.role === 'human');
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
      lastScrollHeightRef.current = root.scrollHeight;
      nearBottomRef.current = true;
    } else if (!showEmptyState && transcriptChanged && (nearBottomRef.current || ownMessageAppended)) {
      root.scrollTop = root.scrollHeight;
      lastScrollHeightRef.current = root.scrollHeight;
      nearBottomRef.current = true;
    }
    const nextNearBottom = nearBottomRef.current;
    previousRenderStateRef.current = {
      messageCount: messages.length,
      lastMessageId: lastMessage?.id || null,
      lastMessageUpdatedAt: lastMessage?.updatedAt || null,
      pendingFirstBeat,
      footerVisible,
      bottomInsetPx: contentBottomInsetPx,
    };
    onNearBottomChange?.(nextNearBottom);
  }, [activeConversationId, contentBottomInsetPx, footerVisible, lastMessage?.id, lastMessage?.updatedAt, loading, messages.length, onNearBottomChange, pendingFirstBeat, showEmptyState]);

  // An explicit position is newer than automatic follow and any retained read
  // anchor. Route tail navigation through the actual virtualizer too, replacing
  // its previous indexed target before later measurements reconcile scrolling.
  useLayoutEffect(() => {
    if (!positionRequest || !scrollRootRef.current) return;
    cancelInitialPin();
    readingPositionRef.current = null;
    if (positionRequest.messageId !== null) {
      nearBottomRef.current = false;
      return;
    }
    const root = scrollRootRef.current;
    didInitialScrollRef.current = true;
    nearBottomRef.current = true;
    initialPinRef.current = true;
    if (scrollMechanicsRef.current) scrollMechanicsRef.current.toEnd();
    else root.scrollTop = root.scrollHeight;
    lastScrollHeightRef.current = root.scrollHeight;
    initialPinReleaseTimerRef.current = setTimeout(() => {
      if (initialPinRef.current) root.scrollTop = root.scrollHeight;
      initialPinRef.current = false;
      initialPinReleaseTimerRef.current = null;
    }, INITIAL_TRANSCRIPT_PIN_SETTLE_MS);
  }, [activeConversationId, positionRequest?.requestKey, positionRequest?.messageId, cancelInitialPin]);

  useLayoutEffect(() => {
    const root = scrollRootRef.current;
    const contentRoot = contentRootRef.current;
    if (showEmptyState || !root || !contentRoot || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      const preservingInitialPin = initialPinRef.current;
      if (!preservingInitialPin && !nearBottomRef.current) {
        const position = readingPositionRef.current;
        const row = position ? Array.from(root.querySelectorAll<HTMLElement>('[data-canonical-message-id]')).find(item => item.dataset.canonicalMessageId === position.messageId) : null;
        if (position && row) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top + position.offset;
        return;
      }
      root.scrollTop = root.scrollHeight;
      lastScrollHeightRef.current = root.scrollHeight;
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
  }, [onNearBottomChange, showEmptyState]);

  const transcript = (
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
        onPointerDownCapture={event => { cancelInitialPin(); if (event.target === event.currentTarget) onUserNavigate?.(); }}
        onTouchMove={() => { cancelInitialPin(); nearBottomRef.current = false; onUserNavigate?.(); }}
        onKeyDownCapture={event => {
          if (!['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
          cancelInitialPin(); nearBottomRef.current = false; onUserNavigate?.();
        }}
        onWheelCapture={handleWheelCapture}
        style={{
          overflowAnchor: 'none',
          scrollPaddingBottom: contentBottomInsetPx,
        }}
      >
        <div
          ref={contentRootRef}
          className={cn(
            widthPositionClassName,
            'space-y-5 pt-1',
            widthClassName,
            contentPaddingBottomClassName,
            showEmptyState ? 'flex min-h-full flex-col' : '',
          )}
          style={contentBottomInsetPx === undefined ? undefined : { paddingBottom: contentBottomInsetPx }}
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
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[var(--nimi-radius-xl)] border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] px-6 py-7 text-center text-sm text-[var(--nimi-status-danger)] shadow-[0_20px_52px_color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)]">
            <p>{error}</p>
            {errorAction}
          </div>
        ) : null}

        {!loading && !error && bannerContent ? (
          <div className="sticky top-0 z-10">{bannerContent}</div>
        ) : null}

        {!loading && !error && showEmptyState ? (
          <div className="flex w-full flex-1 items-center justify-center">
            <section
              className={cn(
                'w-full',
                compactEmptyState
                  ? 'mr-auto max-w-[620px] rounded-[var(--nimi-radius-xl)] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-5 py-4 text-left shadow-[var(--nimi-elevation-raised)]'
                  : 'px-6 py-7 text-center',
              )}
            >
              <div className={cn(compactEmptyState ? '' : 'mx-auto max-w-[560px]')}>
                {emptyStateAgent ? (
                  <div className="flex flex-col items-center gap-3" data-canonical-empty-agent="true">
                    <Avatar
                      src={emptyStateAgent.avatarUrl ?? null}
                      alt={emptyStateAgent.displayName}
                      size="lg"
                      tone="neutral"
                      className="h-14 w-14 shadow-[var(--nimi-elevation-raised)] ring-1 ring-[var(--nimi-border-subtle)]"
                    />
                    <p className="text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {emptyStateAgent.displayName}
                    </p>
                  </div>
                ) : emptyEyebrow ? (
                  <p className={cn(
                    'font-semibold uppercase tracking-[0.2em] text-[var(--nimi-action-primary-bg)]/70',
                    'text-[length:var(--nimi-type-overline-size)]',
                  )}>
                    {emptyEyebrow}
                  </p>
                ) : null}
                {emptyTitle ? (
                  <h2 className={cn(
                    'mt-3 text-[length:var(--nimi-type-page-title-size)] text-[var(--nimi-text-primary)]',
                    compactEmptyState ? 'font-black tracking-tight' : 'font-semibold',
                  )}>
                    {emptyTitle}
                  </h2>
                ) : null}
                {emptyDescription ? (
                  <p className={cn(
                    'mt-3 text-[var(--nimi-text-secondary)]',
                    compactEmptyState ? 'max-w-[520px] text-[length:var(--nimi-type-body-size)] leading-6 text-[var(--nimi-text-muted)]' : 'mx-auto max-w-xl text-sm leading-7',
                  )}>
                    {emptyDescription}
                  </p>
                ) : null}
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
              </div>
              {emptyStateContent ? (
                <div
                  className={cn(hasEmptyStateCopy ? 'mt-6' : '', 'text-left', compactEmptyState ? '-mx-5' : '-mx-6')}
                  data-canonical-empty-content="true"
                >
                  {emptyStateContent}
                </div>
              ) : null}
            </section>
          </div>
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
            scrollMechanicsRef={scrollMechanicsRef}
            copy={copy}
            messageFocusRequest={positionRequest ?? undefined}
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
  return messageActions ? <CanonicalMessageActionsProvider actions={messageActions} messages={messages} copy={copy} positionRequest={positionRequest}>{transcript}</CanonicalMessageActionsProvider> : transcript;
}
