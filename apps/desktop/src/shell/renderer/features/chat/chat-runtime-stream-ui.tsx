import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChatStreamStatus,
  type CanonicalMessageContentSlot,
  type ConversationCanonicalMessage,
} from '@nimiplatform/nimi-kit/features/chat';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import {
  cancelStream,
  getStreamState,
  subscribeStream,
  type StreamState,
} from '../turns/stream-controller';

function normalizeReasoningText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

export function useConversationStreamState(chatId: string | null): StreamState | null {
  const [state, setState] = useState<StreamState | null>(() => (chatId ? getStreamState(chatId) : null));

  useEffect(() => {
    if (!chatId) {
      setState(null);
      return;
    }
    setState(getStreamState(chatId));
    return subscribeStream((updated) => {
      if (updated.chatId === chatId) {
        setState({ ...updated });
      }
    });
  }, [chatId]);

  return state;
}

export function RuntimeReasoningMessageContent(props: {
  message: ConversationCanonicalMessage;
  reasoningText: string;
  reasoningLabel: ReactNode;
}) {
  const paragraphs = props.message.text
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3">
      <details className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,white)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--nimi-text-muted)]">
          {props.reasoningLabel}
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-[var(--nimi-text-secondary)]">
          {props.reasoningText}
        </pre>
      </details>
      {paragraphs.length > 0 ? (
        <div className="space-y-2">
          {paragraphs.map((paragraph, index) => (
            <p key={`${props.message.id}-paragraph-${index}`} className="whitespace-pre-wrap">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function createReasoningMessageContentRenderer(reasoningLabel: ReactNode): CanonicalMessageContentSlot {
  return (message) => {
    if (message.role !== 'assistant' && message.role !== 'agent') {
      return undefined;
    }
    const reasoningText = normalizeReasoningText(message.metadata?.reasoningText);
    if (!reasoningText) {
      return undefined;
    }
    return (
      <RuntimeReasoningMessageContent
        message={message}
        reasoningText={reasoningText}
        reasoningLabel={reasoningLabel}
      />
    );
  };
}

export function RuntimeStreamFooter(props: {
  chatId: string;
  assistantName: string;
  assistantAvatarUrl: string | null;
  assistantKind: 'agent' | 'human';
  streamState: StreamState | null;
  stopLabel: string;
  interruptedLabel: string;
  reasoningLabel: ReactNode;
  waitingLabel?: string;
  showStreamingText?: boolean;
}) {
  const avatar = useMemo(() => (
    <EntityAvatar
      imageUrl={props.assistantAvatarUrl}
      name={props.assistantName}
      kind={props.assistantKind}
      sizeClassName="mt-1 h-8 w-8 shrink-0"
      textClassName="text-xs font-medium"
    />
  ), [props.assistantAvatarUrl, props.assistantKind, props.assistantName]);

  if (props.streamState && (props.streamState.phase === 'waiting' || props.streamState.phase === 'streaming')) {
    const showStreamingText = props.showStreamingText !== false;
    const isPendingFirstBeat = !props.streamState.partialText && !props.streamState.partialReasoningText;
    const visiblePartialText = showStreamingText
      ? (
        props.streamState.partialText
        || (props.streamState.phase === 'waiting'
          ? (props.waitingLabel || '...')
          : '')
      )
      : (
        isPendingFirstBeat
          ? (props.waitingLabel || '...')
          : ''
      );
    const stopAction = (
      <button
        type="button"
        onClick={() => cancelStream(props.chatId)}
        className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
      >
        {props.stopLabel}
      </button>
    );
    if (!showStreamingText && !isPendingFirstBeat) {
      return (
        <div className="pl-10">
          {stopAction}
        </div>
      );
    }
    return (
      <ChatStreamStatus
        mode="streaming"
        partialText={visiblePartialText}
        reasoningText={props.streamState.partialReasoningText}
        reasoningLabel={props.reasoningLabel}
        avatar={avatar}
        actions={stopAction}
      />
    );
  }

  if (props.streamState && (props.streamState.phase === 'error' || props.streamState.phase === 'cancelled') && props.streamState.interrupted) {
    return (
      <ChatStreamStatus
        mode="interrupted"
        partialText={props.streamState.partialText}
        reasoningText={props.streamState.partialReasoningText}
        reasoningLabel={props.reasoningLabel}
        errorMessage={props.streamState.errorMessage}
        avatar={avatar}
        interruptedSuffix={<span className="ml-1 text-xs text-red-400">[{props.interruptedLabel}]</span>}
      />
    );
  }

  return null;
}
