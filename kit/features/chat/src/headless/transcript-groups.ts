import type {
  CanonicalTranscriptGroup,
  ConversationCanonicalMessage,
} from '../types.js';

export type CanonicalTranscriptMessagePosition = 'single' | 'start' | 'middle' | 'end';

export type CanonicalTranscriptMessageGroupItem = {
  message: ConversationCanonicalMessage;
  groupIndex: number;
  indexInGroup: number;
  groupSize: number;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  position: CanonicalTranscriptMessagePosition;
  showAvatar: boolean;
  showTimestamp: boolean;
};

export type CanonicalTranscriptMessageGroup = {
  groupIndex: number;
  role: ConversationCanonicalMessage['role'];
  items: CanonicalTranscriptMessageGroupItem[];
};

const GROUP_BREAK_GAP_MS = 180_000;

function resolveTimestampMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPosition(
  groupSize: number,
  indexInGroup: number,
): CanonicalTranscriptMessagePosition {
  if (groupSize <= 1) {
    return 'single';
  }
  if (indexInGroup === 0) {
    return 'start';
  }
  if (indexInGroup === groupSize - 1) {
    return 'end';
  }
  return 'middle';
}

function shouldStartNewGroup(
  previous: ConversationCanonicalMessage | null,
  current: ConversationCanonicalMessage,
): boolean {
  if (!previous) {
    return true;
  }
  if (previous.role !== current.role) {
    return true;
  }
  if (previous.kind === 'streaming' || current.kind === 'streaming') {
    return true;
  }
  return Math.abs(resolveTimestampMs(current.createdAt) - resolveTimestampMs(previous.createdAt)) > GROUP_BREAK_GAP_MS;
}

export function buildCanonicalTranscriptMessageGroups(
  messages: readonly ConversationCanonicalMessage[],
): CanonicalTranscriptMessageGroup[] {
  const groups: CanonicalTranscriptMessageGroup[] = [];
  let currentMessages: ConversationCanonicalMessage[] = [];
  let previous: ConversationCanonicalMessage | null = null;
  let groupIndex = 0;

  const pushGroup = () => {
    if (currentMessages.length === 0) {
      return;
    }
    const items = currentMessages.map((message, indexInGroup) => ({
      message,
      groupIndex,
      indexInGroup,
      groupSize: currentMessages.length,
      isGroupStart: indexInGroup === 0,
      isGroupEnd: indexInGroup === currentMessages.length - 1,
      position: toPosition(currentMessages.length, indexInGroup),
      showAvatar: currentMessages.length === 1 || indexInGroup === 0 || indexInGroup === currentMessages.length - 1,
      showTimestamp: indexInGroup === currentMessages.length - 1,
    }));
    groups.push({
      groupIndex,
      role: currentMessages[0]?.role || 'assistant',
      items,
    });
    currentMessages = [];
    groupIndex += 1;
  };

  for (const message of messages) {
    if (shouldStartNewGroup(previous, message)) {
      pushGroup();
    }
    currentMessages.push(message);
    previous = message;
  }
  pushGroup();
  return groups;
}

export function buildCanonicalTranscriptGroups(
  messages: readonly ConversationCanonicalMessage[],
): readonly CanonicalTranscriptGroup[] {
  const visualGroups = buildCanonicalTranscriptMessageGroups(messages);
  const focusGroupIndex = visualGroups.length > 0 && visualGroups[visualGroups.length - 1]?.role === 'assistant'
    ? visualGroups[visualGroups.length - 1]?.groupIndex ?? -1
    : -1;
  return visualGroups.map((group) => ({
    groupIndex: group.groupIndex,
    role: group.role,
    focused: group.groupIndex === focusGroupIndex,
    messages: group.items.map((item) => item.message),
  }));
}
