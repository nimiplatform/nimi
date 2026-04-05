import { useCallback, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageAvatarSlot,
  CanonicalMessageContentSlot,
  CanonicalMessageRenderContext,
  ConversationCanonicalMessage,
  ConversationCharacterData,
} from '../types.js';
import { CanonicalMessageBubble } from './canonical-message-bubble.js';
import { CanonicalTypingBubble } from './canonical-typing-bubble.js';
import { CANONICAL_STAGE_SURFACE_WIDTH_CLASS } from './canonical-conversation-pane.js';

const STAGE_SWITCH_DELTA_THRESHOLD = 120;
const STAGE_SWITCH_WINDOW_MS = 400;
const STAGE_CARD_VISUAL_ANCHOR_TOP = '44%';

type StageConversationSlice = {
  userMessage: ConversationCanonicalMessage | null;
  assistantMessages: ConversationCanonicalMessage[];
  pendingFirstBeat: boolean;
};

function resolveStageConversationSlice(input: {
  messages: readonly ConversationCanonicalMessage[];
  pendingFirstBeat: boolean;
}): StageConversationSlice {
  const latestUserMessage = [...input.messages].reverse().find((message) => message.role === 'user' || message.role === 'human') || null;
  const lastMessage = input.messages[input.messages.length - 1] || null;
  const shouldShowPendingUserTurn = input.pendingFirstBeat && (lastMessage?.role === 'user' || lastMessage?.role === 'human');
  if (shouldShowPendingUserTurn) {
    return {
      userMessage: latestUserMessage,
      assistantMessages: [],
      pendingFirstBeat: true,
    };
  }

  let lastAssistantIndex = -1;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role === 'assistant' || message?.role === 'agent') {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex < 0) {
    return {
      userMessage: latestUserMessage,
      assistantMessages: [],
      pendingFirstBeat: input.pendingFirstBeat,
    };
  }

  let userMessage: ConversationCanonicalMessage | null = null;
  for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role === 'user' || message?.role === 'human') {
      userMessage = message;
      break;
    }
  }

  const assistantMessages = input.messages
    .slice(userMessage ? input.messages.indexOf(userMessage) + 1 : Math.max(0, lastAssistantIndex))
    .filter((message) => message.role === 'assistant' || message.role === 'agent');

  return {
    userMessage,
    assistantMessages,
    pendingFirstBeat: false,
  };
}

export type CanonicalStagePanelProps = {
  characterData?: ConversationCharacterData | null;
  messages: readonly ConversationCanonicalMessage[];
  pendingFirstBeat?: boolean;
  content?: ReactNode;
  footerContent?: ReactNode;
  widthClassName?: string;
  anchorViewportRef?: RefObject<HTMLDivElement | null>;
  cardAnchorOffsetPx?: number | null;
  onIntentOpenHistory?: () => void;
  renderMessageContent?: CanonicalMessageContentSlot;
  renderMessageAvatar?: CanonicalMessageAvatarSlot;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  agentAvatarUrl?: string | null;
  agentName?: string;
  voicePlayingMessageId?: string | null;
  isVoiceTranscriptVisible?: (message: ConversationCanonicalMessage) => boolean;
  onPlayVoiceMessage?: (message: ConversationCanonicalMessage) => void;
  onVoiceContextMenu?: (message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLButtonElement>) => void;
};

function toStageRenderContext(
  message: ConversationCanonicalMessage,
  index: number,
  total: number,
): CanonicalMessageRenderContext {
  const isCurrentUser = message.role === 'user' || message.role === 'human';
  const position = total <= 1
    ? 'single'
    : index === 0
      ? 'start'
      : index === total - 1
        ? 'end'
        : 'middle';
  return {
    groupIndex: 0,
    indexInGroup: index,
    groupSize: total,
    position,
    isCurrentUser,
    isFocusedAssistantGroup: !isCurrentUser,
    displayContext: 'stage',
  };
}

export function CanonicalStagePanel(props: CanonicalStagePanelProps) {
  const upwardIntentRef = useRef({ distance: 0, lastAt: 0 });
  const slice = useMemo(() => resolveStageConversationSlice({
    messages: props.messages,
    pendingFirstBeat: Boolean(props.pendingFirstBeat),
  }), [props.messages, props.pendingFirstBeat]);
  const theme = props.characterData?.theme;
  const showEmptyState = !props.content && !slice.userMessage && slice.assistantMessages.length === 0 && !slice.pendingFirstBeat;
  const widthClassName = props.widthClassName || CANONICAL_STAGE_SURFACE_WIDTH_CLASS;

  const handleWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!props.onIntentOpenHistory) {
      return;
    }
    const now = performance.now();
    const root = event.currentTarget.querySelector<HTMLElement>('[data-canonical-stage-scroll-root="true"]');
    const cardAtTop = !root || root.scrollTop <= 4;
    if (event.deltaY >= 0 || !cardAtTop) {
      upwardIntentRef.current = { distance: 0, lastAt: now };
      return;
    }
    const previous = upwardIntentRef.current;
    const nextDistance = now - previous.lastAt > STAGE_SWITCH_WINDOW_MS
      ? Math.abs(event.deltaY)
      : previous.distance + Math.abs(event.deltaY);
    upwardIntentRef.current = { distance: nextDistance, lastAt: now };
    if (nextDistance >= STAGE_SWITCH_DELTA_THRESHOLD) {
      upwardIntentRef.current = { distance: 0, lastAt: now };
      props.onIntentOpenHistory();
    }
  }, [props]);

  return (
    <div
      ref={props.anchorViewportRef}
      className="relative min-h-0 flex-1 overflow-hidden px-5 pb-4 pt-5"
      data-canonical-stage-root="true"
      onWheelCapture={handleWheelCapture}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[58%]"
        style={{ background: theme?.roomAura || 'radial-gradient(circle at top, rgba(16,185,129,0.14), transparent 62%)', opacity: 0.9 }}
      />

      <div className="relative z-10 flex h-full min-h-0 items-start justify-center pt-4">
        <div
          className={`w-full ${widthClassName}`}
          data-canonical-stage-width={widthClassName}
        >
          <div className="w-full rounded-[30px] border border-emerald-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.92))] p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between gap-3 px-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700/70">
                  This Moment
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {slice.assistantMessages.length > 0
                    ? `${slice.assistantMessages.length} beat${slice.assistantMessages.length === 1 ? '' : 's'} in focus`
                    : 'The current turn appears here first'}
                </p>
              </div>
            </div>

            <div
              data-canonical-stage-scroll-root="true"
              className="max-h-[44vh] overflow-y-auto overscroll-contain rounded-[24px] border border-slate-200/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] px-4 py-4 backdrop-blur-sm"
            >
              {props.content ? (
                props.content
              ) : showEmptyState ? (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="h-14 w-14 rounded-full bg-[radial-gradient(circle,_rgba(94,234,212,0.28),_rgba(255,255,255,0.96))] shadow-[0_14px_28px_rgba(20,184,166,0.18)]" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-800">
                      Waiting for the first exchange
                    </p>
                    <p className="text-sm leading-6 text-slate-500">
                      The stage keeps the current turn in focus before the full history takes over.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {slice.userMessage ? (
                    <CanonicalMessageBubble
                      message={slice.userMessage}
                      avatar={props.renderMessageAvatar?.(
                        slice.userMessage,
                        toStageRenderContext(slice.userMessage, 0, 1),
                      )}
                      content={props.renderMessageContent?.(
                        slice.userMessage,
                        toStageRenderContext(slice.userMessage, 0, 1),
                      )}
                      accessory={props.renderMessageAccessory?.(
                        slice.userMessage,
                        toStageRenderContext(slice.userMessage, 0, 1),
                      )}
                      showAvatar
                      showTimestamp
                      position="single"
                      displayContext="stage"
                      voicePlayingMessageId={props.voicePlayingMessageId}
                      isVoiceTranscriptVisible={props.isVoiceTranscriptVisible?.(slice.userMessage)}
                      onPlayVoiceMessage={props.onPlayVoiceMessage}
                      onVoiceContextMenu={props.onVoiceContextMenu}
                    />
                  ) : null}
                  {slice.assistantMessages.map((message, index) => (
                    <CanonicalMessageBubble
                      key={message.id}
                      message={message}
                      avatar={props.renderMessageAvatar?.(
                        message,
                        toStageRenderContext(message, index, slice.assistantMessages.length),
                      )}
                      content={props.renderMessageContent?.(
                        message,
                        toStageRenderContext(message, index, slice.assistantMessages.length),
                      )}
                      accessory={props.renderMessageAccessory?.(
                        message,
                        toStageRenderContext(message, index, slice.assistantMessages.length),
                      )}
                      showAvatar={index === 0 || index === slice.assistantMessages.length - 1}
                      showTimestamp={index === slice.assistantMessages.length - 1}
                      position={slice.assistantMessages.length <= 1 ? 'single' : index === 0 ? 'start' : index === slice.assistantMessages.length - 1 ? 'end' : 'middle'}
                      displayContext="stage"
                      voicePlayingMessageId={props.voicePlayingMessageId}
                      isVoiceTranscriptVisible={props.isVoiceTranscriptVisible?.(message)}
                      onPlayVoiceMessage={props.onPlayVoiceMessage}
                      onVoiceContextMenu={props.onVoiceContextMenu}
                    />
                  ))}
                  {slice.pendingFirstBeat ? (
                    <CanonicalTypingBubble
                      agentAvatarUrl={props.agentAvatarUrl}
                      agentName={props.agentName || props.characterData?.name || 'Assistant'}
                      agentRoleLabel="Assistant pending"
                      thinkingLabel="Thinking…"
                    />
                  ) : null}
                  {props.footerContent}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
