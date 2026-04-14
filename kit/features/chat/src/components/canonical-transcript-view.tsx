import { memo, useCallback, useLayoutEffect, useMemo, useRef, type ReactNode, type UIEvent } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageAvatarSlot,
  CanonicalMessageContentSlot,
  CanonicalMessageRenderContext,
  CanonicalTranscriptGroup,
  ConversationCanonicalMessage,
} from '../types.js';
import { CanonicalMessageBubble } from './canonical-message-bubble.js';
import { CanonicalTypingBubble } from './canonical-typing-bubble.js';
import { CANONICAL_STAGE_SURFACE_WIDTH_CLASS } from './canonical-conversation-pane.js';

type MessageVisualPosition = 'single' | 'start' | 'middle' | 'end';

type MessageVisualItem = {
  message: ConversationCanonicalMessage;
  groupIndex: number;
  indexInGroup: number;
  groupSize: number;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  position: MessageVisualPosition;
  showAvatar: boolean;
  showTimestamp: boolean;
};

type MessageVisualGroup = {
  groupIndex: number;
  role: ConversationCanonicalMessage['role'];
  items: MessageVisualItem[];
};

const GROUP_BREAK_GAP_MS = 180_000;

function resolveTimestampMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPosition(groupSize: number, indexInGroup: number): MessageVisualPosition {
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

function buildMessageVisualGroups(messages: readonly ConversationCanonicalMessage[]): MessageVisualGroup[] {
  const groups: MessageVisualGroup[] = [];
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

function toRenderContext(input: {
  item: MessageVisualItem;
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

function formatDateLabel(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - messageDay.getTime()) / 86400000);
  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  return date.toLocaleDateString();
}

const TRANSCRIPT_SWITCH_DELTA_THRESHOLD = 300;
const TRANSCRIPT_SWITCH_WINDOW_MS = 600;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 80;
}

const TranscriptMessageGroups = memo(function TranscriptMessageGroups(props: {
  messages: readonly ConversationCanonicalMessage[];
  renderMessageContent?: CanonicalMessageContentSlot;
  renderMessageAvatar?: CanonicalMessageAvatarSlot;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  voicePlayingMessageId?: string | null;
  isVoiceTranscriptVisible?: (message: ConversationCanonicalMessage) => boolean;
  onPlayVoiceMessage?: (message: ConversationCanonicalMessage) => void;
  onVoiceContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLButtonElement>) => void;
  onMessageContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const visualGroups = useMemo(() => buildMessageVisualGroups(props.messages), [props.messages]);
  const focusGroupIndex = visualGroups.length > 0 && visualGroups[visualGroups.length - 1]?.role === 'assistant'
    ? visualGroups[visualGroups.length - 1]?.groupIndex ?? -1
    : -1;
  const nodes: ReactNode[] = [];
  let lastDate: Date | null = null;

  for (const group of visualGroups) {
    const groupNodes: ReactNode[] = [];
    const isFocusedAssistantGroup = group.groupIndex === focusGroupIndex;
    for (const item of group.items) {
      const renderContext = toRenderContext({
        item,
        focused: isFocusedAssistantGroup,
      });
      const messageDate = new Date(item.message.createdAt);
      if (!lastDate || !isSameDay(lastDate, messageDate)) {
        groupNodes.push(
          <div key={`date-${item.message.id}`} className="flex items-center gap-3 py-4">
            <div className="h-px flex-1 bg-slate-200/70" />
            <span className="shrink-0 rounded-full border border-white/80 bg-white/72 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-[0_12px_26px_rgba(15,23,42,0.05)]">
              {formatDateLabel(item.message.createdAt)}
            </span>
            <div className="h-px flex-1 bg-slate-200/70" />
          </div>,
        );
        lastDate = messageDate;
      }
      groupNodes.push(
        <CanonicalMessageBubble
          key={item.message.id}
          message={item.message}
          avatar={null}
          content={props.renderMessageContent?.(item.message, renderContext)}
          accessory={props.renderMessageAccessory
            ? props.renderMessageAccessory(item.message, renderContext)
            : item.showTimestamp
              ? undefined
              : null}
          showAvatar={false}
          showTimestamp={item.showTimestamp}
          position={item.position}
          displayContext="transcript"
          voicePlayingMessageId={props.voicePlayingMessageId}
          isVoiceTranscriptVisible={props.isVoiceTranscriptVisible?.(item.message)}
          onPlayVoiceMessage={props.onPlayVoiceMessage}
          onVoiceContextMenu={props.onVoiceContextMenu}
          onMessageContextMenu={props.onMessageContextMenu}
        />,
      );
    }

    nodes.push(
      <section key={`group-${group.groupIndex}`} className="space-y-2.5">
        {groupNodes}
      </section>,
    );
  }

  return <>{nodes}</>;
});

export function buildCanonicalTranscriptGroups(
  messages: readonly ConversationCanonicalMessage[],
): readonly CanonicalTranscriptGroup[] {
  const visualGroups = buildMessageVisualGroups(messages);
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

export type CanonicalTranscriptViewProps = {
  messages: readonly ConversationCanonicalMessage[];
  loading?: boolean;
  error?: string | null;
  pendingFirstBeat?: boolean;
  agentAvatarUrl?: string | null;
  agentName?: string;
  loadingLabel?: string;
  emptyEyebrow?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  historyIntro?: string | null;
  /** Non-blocking banner rendered above the message list (does not replace messages). */
  bannerContent?: ReactNode;
  content?: ReactNode;
  widthClassName?: string;
  onNearBottomChange?: (value: boolean) => void;
  onSeedFirstTurn?: () => void;
  footerContent?: ReactNode;
  renderMessageContent?: CanonicalMessageContentSlot;
  renderMessageAvatar?: CanonicalMessageAvatarSlot;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  voicePlayingMessageId?: string | null;
  isVoiceTranscriptVisible?: (message: ConversationCanonicalMessage) => boolean;
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
  loading = false,
  error = null,
  pendingFirstBeat = false,
  agentAvatarUrl = null,
  agentName = 'Assistant',
  loadingLabel = 'Loading conversation...',
  emptyEyebrow = 'This Moment',
  emptyTitle = 'Start the first turn',
  emptyDescription = 'The transcript stays empty until the first exchange is created.',
  historyIntro = null,
  bannerContent,
  content,
  widthClassName = CANONICAL_STAGE_SURFACE_WIDTH_CLASS,
  onNearBottomChange,
  onSeedFirstTurn,
  footerContent,
  renderMessageContent,
  renderMessageAvatar,
  renderMessageAccessory,
  voicePlayingMessageId = null,
  isVoiceTranscriptVisible,
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
    <div
      ref={scrollRootRef}
      className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-5"
      data-canonical-transcript-root="true"
      onScroll={handleScroll}
      onWheelCapture={handleWheelCapture}
      style={{
        overflowAnchor: 'none',
      }}
    >
      <div className={cn('mx-auto space-y-5', widthClassName)} data-canonical-transcript-width={widthClassName}>
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
          <section className="rounded-[30px] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(239,247,247,0.88))] px-6 py-7 text-center shadow-[0_20px_52px_rgba(15,23,42,0.08)]">
            <p className={cn('text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700/70')}>
              {emptyEyebrow}
            </p>
            <h2 className="mt-3 text-[30px] font-black tracking-tight text-slate-950">
              {emptyTitle}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-600">
              {emptyDescription}
            </p>
            {onSeedFirstTurn ? (
              <button
                type="button"
                onClick={onSeedFirstTurn}
                className="mt-5 inline-flex h-11 items-center rounded-full bg-gradient-to-br from-emerald-400 via-teal-400 to-emerald-500 px-5 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(78,204,163,0.3)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_22px_44px_rgba(78,204,163,0.4)]"
              >
                Start the conversation
              </button>
            ) : null}
          </section>
        ) : null}

        {!loading && !error && messages.length > 0 && historyIntro ? (
          <div className="rounded-full border border-white/80 bg-white/72 px-4 py-2 text-center text-[11px] font-medium text-slate-500 shadow-[0_12px_26px_rgba(15,23,42,0.05)]">
            {historyIntro}
          </div>
        ) : null}

        {!loading && !error && content ? content : null}

        {!loading && !error && !content && messages.length > 0 ? (
          <section className="space-y-4">
            <TranscriptMessageGroups
              messages={messages}
              renderMessageContent={renderMessageContent}
              renderMessageAvatar={renderMessageAvatar}
              renderMessageAccessory={renderMessageAccessory}
              voicePlayingMessageId={voicePlayingMessageId}
              isVoiceTranscriptVisible={isVoiceTranscriptVisible}
              onPlayVoiceMessage={onPlayVoiceMessage}
              onVoiceContextMenu={onVoiceContextMenu}
              onMessageContextMenu={onMessageContextMenu}
            />
            {pendingFirstBeat ? (
              <div className="py-1">
                <CanonicalTypingBubble
                  agentName={agentName}
                  agentRoleLabel="Assistant pending"
                  thinkingLabel="Thinking…"
                  onStop={onStopGenerating}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && !error && !pendingFirstBeat && footerContent ? footerContent : null}
      </div>
    </div>
  );
}
