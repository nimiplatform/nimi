import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { ChatCopy } from '../copy.js';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageAvatarSlot,
  CanonicalMessageContentSlot,
  ConversationCanonicalMessage,
} from '../types.js';
import {
  buildCanonicalTranscriptVirtualItems,
  toCanonicalTranscriptRenderContext,
  type CanonicalTranscriptDateLabelFormatter,
  type CanonicalTranscriptVirtualItem,
} from './canonical-transcript-virtual-items.js';
import { CanonicalMessageBubble } from './canonical-message-bubble.js';
import { useCanonicalMessageActionContext } from './canonical-message-actions.js';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';

const VIRTUALIZATION_THRESHOLD = 30;
export type CanonicalTranscriptScrollMechanics = { toEnd: () => void; cancel: () => void };

type TranscriptMessageGroupsProps = {
  messages: readonly ConversationCanonicalMessage[];
  scrollRef: RefObject<HTMLElement | null>;
  copy?: ChatCopy;
  renderMessageContent?: CanonicalMessageContentSlot;
  renderMessageAvatar?: CanonicalMessageAvatarSlot;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  voicePlayingMessageId?: string | null;
  isVoiceTranscriptVisible?: (message: ConversationCanonicalMessage) => boolean;
  disableRpContent?: boolean;
  onPlayVoiceMessage?: (message: ConversationCanonicalMessage) => void;
  onVoiceContextMenu?: (message: ConversationCanonicalMessage, event: MouseEvent<HTMLButtonElement>) => void;
  onMessageContextMenu?: (message: ConversationCanonicalMessage, event: MouseEvent<HTMLDivElement>) => void;
  formatDateLabel?: CanonicalTranscriptDateLabelFormatter;
  messageFocusRequest?: { messageId: string | null; requestKey: number; offset?: number };
  onFocusComplete?: (requestKey: number) => void;
  activeMessageId?: string | null;
  onMessageFocus?: (messageId: string) => void;
  onNavigate?: (messageId: string, delta: number) => void;
  scrollMechanicsRef?: RefObject<CanonicalTranscriptScrollMechanics | null>;
};

function DateSeparatorRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-[var(--nimi-border-subtle)]" />
      <span className="shrink-0 rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-3 py-1 text-[length:var(--nimi-type-overline-size)] font-medium text-[var(--nimi-text-muted)]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--nimi-border-subtle)]" />
    </div>
  );
}

// Range and measurement updates move the outer layout wrapper. Keep the
// message slots and Bubble stable while all their actual inputs are unchanged.
const TranscriptMessageItem = memo(function TranscriptMessageItem(props: Omit<TranscriptMessageGroupsProps, 'messages' | 'scrollRef' | 'formatDateLabel'> & {
  virtualItem: Extract<CanonicalTranscriptVirtualItem, { type: 'message' }>;
}) {
  const { virtualItem } = props;
  const actions = useCanonicalMessageActionContext();
  const message = virtualItem.item.message;
  const localUser = message.source === 'agent' && (message.role === 'user' || message.role === 'human');
  const localApp = message.source === 'agent' && message.role === 'system' && message.metadata?.canonicalOrigin === 'app';
  const authorLabel = localApp ? actions?.copy.quoteAppSourceLabel : localUser ? actions?.copy.bubbleUserLabel : message.senderName || actions?.copy.bubbleAssistantLabel;
  const articleRef = useRef<HTMLDivElement>(null);
  const active = props.activeMessageId === virtualItem.item.message.id;
  useLayoutEffect(() => {
    if (!actions || !articleRef.current) return;
    const original = new Map<HTMLElement, string | null>();
    const update = () => {
      for (const element of articleRef.current!.querySelectorAll<HTMLElement>('button, a[href], input, summary, [tabindex]')) {
        if (element === articleRef.current) continue;
        if (!original.has(element)) original.set(element, element.getAttribute('tabindex'));
        if (!active) element.tabIndex = -1;
        else { const value = original.get(element); if (value === null) element.removeAttribute('tabindex'); else if (value !== undefined) element.setAttribute('tabindex', value); }
      }
    };
    update();
    const observer = new MutationObserver(update); observer.observe(articleRef.current, { childList: true, subtree: true });
    return () => { observer.disconnect(); for (const [element, value] of original) { if (value === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', value); } };
  }, [active, Boolean(actions)]);
  const renderContext = toCanonicalTranscriptRenderContext({ item: virtualItem.item, focused: virtualItem.focused });
  const renderedAvatar = props.renderMessageAvatar?.(virtualItem.item.message, renderContext);
  // Surfaces without an avatar renderer must not reserve the 32px avatar gutter,
  // otherwise message text indents away from the shared content column edges.
  const avatarSlot = renderedAvatar === undefined ? null : renderedAvatar;
  return (
    <div ref={articleRef} data-canonical-message-id={virtualItem.item.message.id}
      role={actions ? 'article' : undefined} tabIndex={actions ? active ? 0 : -1 : undefined}
      aria-label={actions ? `${authorLabel} — ${actions.copy.messageActionsLabel}` : undefined}
      className={actions ? `rounded-[var(--nimi-radius-sm)] ${FOCUS_RING_CLASS_NAME}` : undefined}
      onFocusCapture={() => props.onMessageFocus?.(virtualItem.item.message.id)}
      onKeyDown={event => {
        if (!actions) return;
        const atRoot = event.target === event.currentTarget;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (atRoot) actions.actions.onReturnToComposer?.(); else event.currentTarget.focus({ preventScroll: true }); return; }
        if (!atRoot) return;
        if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); props.onNavigate?.(virtualItem.item.message.id, event.key === 'PageUp' ? -1 : 1); }
        if (event.key === 'Enter' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); actions.open(virtualItem.item.message, event.currentTarget); }
        if (event.ctrlKey && event.key === 'End') { event.preventDefault(); actions.actions.onReturnToComposer?.(); }
        if (event.ctrlKey && event.key === 'Home') { event.preventDefault(); event.currentTarget.closest('[data-message-feed]')?.querySelector<HTMLElement>('summary')?.focus(); }
      }}>
      <CanonicalMessageBubble
        message={virtualItem.item.message}
        avatar={avatarSlot}
        content={props.renderMessageContent?.(virtualItem.item.message, renderContext)}
        accessory={props.renderMessageAccessory
          ? props.renderMessageAccessory(virtualItem.item.message, renderContext)
          : virtualItem.item.showTimestamp
            ? undefined
            : null}
        showAvatar={Boolean(renderedAvatar) && virtualItem.item.showAvatar}
        showTimestamp={virtualItem.item.showTimestamp}
        position={virtualItem.item.position}
        displayContext="transcript"
        copy={props.copy}
        voicePlayingMessageId={props.voicePlayingMessageId}
        isVoiceTranscriptVisible={props.isVoiceTranscriptVisible?.(virtualItem.item.message)}
        disableRpContent={props.disableRpContent}
        onPlayVoiceMessage={props.onPlayVoiceMessage}
        onVoiceContextMenu={props.onVoiceContextMenu}
        onMessageContextMenu={props.onMessageContextMenu}
      />
    </div>
  );
});

function NonVirtualizedTranscript(props: TranscriptMessageGroupsProps) {
  const { messages, scrollRef: _scrollRef, formatDateLabel, ...rowProps } = props;
  const flatItems = useMemo(
    () => buildCanonicalTranscriptVirtualItems(messages, formatDateLabel),
    [formatDateLabel, messages],
  );
  useLayoutEffect(() => {
    if (!props.messageFocusRequest) return;
    const target = Array.from(scrollRefElements(props.scrollRef)).find(item => item.dataset.canonicalMessageId === props.messageFocusRequest!.messageId);
    target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'nearest' });
    if (target && props.scrollRef.current) {
      props.scrollRef.current.scrollTop += target.getBoundingClientRect().top - props.scrollRef.current.getBoundingClientRect().top + (props.messageFocusRequest.offset || 0);
      props.onFocusComplete?.(props.messageFocusRequest.requestKey);
    }
  }, [props.messageFocusRequest, props.scrollRef]);
  return (
    <>
      {flatItems.map((vi) => {
        if (vi.type === 'date') {
          return <DateSeparatorRow key={vi.key} label={vi.label} />;
        }
        return (
          <div key={vi.key} style={{ paddingTop: vi.isGroupStart ? 16 : 10 }}>
            <TranscriptMessageItem {...rowProps} virtualItem={vi} />
          </div>
        );
      })}
    </>
  );
}

function VirtualizedTranscript(props: TranscriptMessageGroupsProps) {
  const { messages, scrollRef, formatDateLabel, ...rowProps } = props;
  const flatItems = useMemo(
    () => buildCanonicalTranscriptVirtualItems(messages, formatDateLabel),
    [formatDateLabel, messages],
  );

  const estimateSize = useCallback((index: number) => {
    const item = flatItems[index];
    if (!item) return 80;
    if (item.type === 'date') return 52;
    const kind = item.item.message.kind;
    if (kind === 'image' || kind === 'image-pending' || kind === 'video' || kind === 'video-pending') return 400;
    return 80;
  }, [flatItems]);

  // Late media is inserted beside its original turn. Measurements must follow
  // message identity, not the index it occupied before that insertion.
  const getItemKey = useCallback((index: number) => flatItems[index]!.key, [flatItems]);
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getItemKey,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 5,
    rangeExtractor: range => {
      const selected = flatItems.findIndex(item => item.type === 'message' && item.item.message.id === props.activeMessageId);
      return Array.from(new Set([...defaultRangeExtractor(range), ...(selected >= 0 ? [selected] : [])])).sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    if (!props.scrollMechanicsRef) return;
    const ref = props.scrollMechanicsRef;
    const mechanics = { toEnd: () => virtualizer.scrollToEnd(), cancel: () => virtualizer.cancelScroll() };
    ref.current = mechanics;
    return () => { if (ref.current === mechanics) ref.current = null; };
  }, [props.scrollMechanicsRef, virtualizer]);
  useLayoutEffect(() => {
    const request = props.messageFocusRequest;
    if (!request) return;
    const index = flatItems.findIndex(item => item.type === 'message' && item.item.message.id === request.messageId);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: 'auto' });
    const frame = requestAnimationFrame(() => {
      const target = Array.from(scrollRefElements(scrollRef)).find(item => item.dataset.canonicalMessageId === request.messageId);
      target?.focus({ preventScroll: true });
      if (target && scrollRef.current) { scrollRef.current.scrollTop += target.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top + (request.offset || 0); props.onFocusComplete?.(request.requestKey); }
    });
    return () => cancelAnimationFrame(frame);
  }, [props.messageFocusRequest, flatItems, scrollRef, virtualizer]);

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const vi = flatItems[virtualRow.index];
        if (!vi) return null;
        const spacingTop = vi.type === 'date' ? 0 : vi.isGroupStart ? 16 : 10;
        return (
          <div
            key={vi.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
              paddingTop: spacingTop,
            }}
          >
            {vi.type === 'date'
              ? <DateSeparatorRow label={vi.label} />
              : <TranscriptMessageItem {...rowProps} virtualItem={vi} />}
          </div>
        );
      })}
    </div>
  );
}

export const TranscriptMessageGroups = memo(function TranscriptMessageGroups(props: TranscriptMessageGroupsProps) {
  const actions = useCanonicalMessageActionContext();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(props.messages.at(-1)?.id || null);
  const [focusRequest, setFocusRequest] = useState<{ messageId: string; requestKey: number; offset?: number; origin: 'external' | 'keyboard' }>();
  const focusCounter = useRef(0);
  useLayoutEffect(() => {
    if (props.messageFocusRequest?.messageId === null) {
      setActiveMessageId(props.messages.at(-1)?.id || null);
      setFocusRequest(undefined);
    } else if (props.messageFocusRequest) {
      setActiveMessageId(props.messageFocusRequest.messageId);
      setFocusRequest({ ...props.messageFocusRequest, messageId: props.messageFocusRequest.messageId, requestKey: ++focusCounter.current, origin: 'external' });
    } else setFocusRequest(current => current?.origin === 'external' ? undefined : current);
  }, [props.messageFocusRequest?.requestKey, props.messageFocusRequest?.messageId]);
  useLayoutEffect(() => {
    if (!props.messages.some(item => item.id === activeMessageId)) setActiveMessageId(props.messages.at(-1)?.id || null);
  }, [props.messages, activeMessageId]);
  const onNavigate = (messageId: string, delta: number) => {
    const index = props.messages.findIndex(item => item.id === messageId);
    const target = props.messages[Math.max(0, Math.min(props.messages.length - 1, index + delta))];
    if (target) { setActiveMessageId(target.id); setFocusRequest({ messageId: target.id, requestKey: ++focusCounter.current, origin: 'keyboard' }); }
  };
  const rowProps = actions ? { ...props, activeMessageId, onMessageFocus: setActiveMessageId, onNavigate, messageFocusRequest: focusRequest,
    onFocusComplete: (requestKey: number) => setFocusRequest(current => current?.requestKey === requestKey ? undefined : current) } : props;
  const shouldVirtualize = props.messages.length >= VIRTUALIZATION_THRESHOLD;
  const content = shouldVirtualize ? <VirtualizedTranscript {...rowProps} /> : <NonVirtualizedTranscript {...rowProps} />;
  return actions ? <section role="feed" aria-label={actions.copy.messageNavigationLabel} data-message-feed>
    <details className="mb-2 text-xs text-[var(--nimi-text-secondary)]"><summary className={FOCUS_RING_CLASS_NAME}>{actions.copy.messageKeyboardHelpLabel}</summary><p>{actions.copy.messageKeyboardHelp}</p></details>
    {content}
  </section> : content;
});

function scrollRefElements(ref: RefObject<HTMLElement | null>) { return ref.current?.querySelectorAll<HTMLElement>('[data-canonical-message-id]') || []; }
