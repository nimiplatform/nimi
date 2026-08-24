import { memo, useCallback, useMemo, type MouseEvent, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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

const VIRTUALIZATION_THRESHOLD = 30;

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

function renderMessageItem(
  virtualItem: Extract<CanonicalTranscriptVirtualItem, { type: 'message' }>,
  props: TranscriptMessageGroupsProps,
) {
  const renderContext = toCanonicalTranscriptRenderContext({ item: virtualItem.item, focused: virtualItem.focused });
  const renderedAvatar = props.renderMessageAvatar?.(virtualItem.item.message, renderContext);
  // Surfaces without an avatar renderer must not reserve the 32px avatar gutter,
  // otherwise message text indents away from the shared content column edges.
  const avatarSlot = renderedAvatar === undefined ? null : renderedAvatar;
  return (
    <div>
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
}

function NonVirtualizedTranscript(props: TranscriptMessageGroupsProps) {
  const flatItems = useMemo(
    () => buildCanonicalTranscriptVirtualItems(props.messages, props.formatDateLabel),
    [props.formatDateLabel, props.messages],
  );
  return (
    <>
      {flatItems.map((vi) => {
        if (vi.type === 'date') {
          return <DateSeparatorRow key={vi.key} label={vi.label} />;
        }
        return (
          <div key={vi.key} style={{ paddingTop: vi.isGroupStart ? 16 : 10 }}>
            {renderMessageItem(vi, props)}
          </div>
        );
      })}
    </>
  );
}

function VirtualizedTranscript(props: TranscriptMessageGroupsProps) {
  const flatItems = useMemo(
    () => buildCanonicalTranscriptVirtualItems(props.messages, props.formatDateLabel),
    [props.formatDateLabel, props.messages],
  );

  const estimateSize = useCallback((index: number) => {
    const item = flatItems[index];
    if (!item) return 80;
    if (item.type === 'date') return 52;
    const kind = item.item.message.kind;
    if (kind === 'image' || kind === 'image-pending' || kind === 'video' || kind === 'video-pending') return 400;
    return 80;
  }, [flatItems]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => props.scrollRef.current,
    estimateSize,
    overscan: 5,
  });

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
              : renderMessageItem(vi, props)}
          </div>
        );
      })}
    </div>
  );
}

export const TranscriptMessageGroups = memo(function TranscriptMessageGroups(props: TranscriptMessageGroupsProps) {
  const shouldVirtualize = props.messages.length >= VIRTUALIZATION_THRESHOLD;
  if (shouldVirtualize) {
    return <VirtualizedTranscript {...props} />;
  }
  return <NonVirtualizedTranscript {...props} />;
});
