import type {
  CanonicalMessageRenderContext,
  ConversationCanonicalMessage,
} from '../types.js';
import {
  buildCanonicalTranscriptMessageGroups,
  type CanonicalTranscriptMessageGroupItem,
} from '../headless/transcript-groups.js';

export type CanonicalTranscriptMessageVisualItem = CanonicalTranscriptMessageGroupItem;

export type CanonicalTranscriptVirtualItem =
  | { type: 'date'; key: string; label: string }
  | {
      type: 'message';
      key: string;
      item: CanonicalTranscriptMessageVisualItem;
      focused: boolean;
      isGroupStart: boolean;
    };

export type CanonicalTranscriptDateLabelFormatter = (input: {
  readonly timestamp: string;
  readonly date: Date;
  readonly diffDays: number;
}) => string;

export function toCanonicalTranscriptRenderContext(input: {
  item: CanonicalTranscriptMessageVisualItem;
  focused: boolean;
}): CanonicalMessageRenderContext {
  const isCurrentUser = input.item.message.role === 'user' || input.item.message.role === 'human';
  return {
    groupIndex: input.item.groupIndex,
    indexInGroup: input.item.indexInGroup,
    groupSize: input.item.groupSize,
    position: input.item.position,
    isCurrentUser,
    isFocusedAssistantGroup: input.focused,
    displayContext: 'transcript',
  };
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatDateLabel(
  input: string,
  formatDateLabelOverride?: CanonicalTranscriptDateLabelFormatter,
): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - messageDay.getTime()) / 86400000);
  const override = formatDateLabelOverride?.({ timestamp: input, date, diffDays });
  if (override) {
    return override;
  }
  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  return date.toLocaleDateString();
}

export function buildCanonicalTranscriptVirtualItems(
  messages: readonly ConversationCanonicalMessage[],
  formatDateLabelOverride?: CanonicalTranscriptDateLabelFormatter,
): CanonicalTranscriptVirtualItem[] {
  const groups = buildCanonicalTranscriptMessageGroups(messages);
  const focusGroupIndex = groups.length > 0 && groups[groups.length - 1]?.role === 'assistant'
    ? groups[groups.length - 1]?.groupIndex ?? -1
    : -1;
  const items: CanonicalTranscriptVirtualItem[] = [];
  let lastDate: Date | null = null;

  for (const group of groups) {
    const isFocused = group.groupIndex === focusGroupIndex;
    for (const item of group.items) {
      const messageDate = new Date(item.message.createdAt);
      if (!lastDate || !isSameDay(lastDate, messageDate)) {
        items.push({
          type: 'date',
          key: `date-${item.message.id}`,
          label: formatDateLabel(item.message.createdAt, formatDateLabelOverride),
        });
        lastDate = messageDate;
      }
      items.push({ type: 'message', key: item.message.id, item, focused: isFocused, isGroupStart: item.isGroupStart });
    }
  }
  return items;
}
