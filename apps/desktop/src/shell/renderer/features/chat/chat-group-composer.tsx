import { useCallback, useMemo, useRef, useState } from 'react';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import { useTranslation } from 'react-i18next';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { CHAT_CONTENT_POSITION_CLASS, CHAT_CONTENT_WIDTH_CLASS } from './chat-shared-content-layout';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;

type AgentMentionOption = {
  accountId: string;
  displayName: string;
};

export function shouldOpenGroupAgentMentionPicker(text: string, selectionStart: number | null | undefined) {
  const cursor = selectionStart ?? text.length;
  const charBefore = text[cursor - 1];
  const charTwoBefore = cursor >= 2 ? text[cursor - 2] : ' ';
  return charBefore === '@' && (!charTwoBefore || /\s/.test(charTwoBefore));
}

export function applyGroupAgentMentionSelection(text: string, displayName: string) {
  const lastAtIdx = text.lastIndexOf('@');
  const insertText = `@${displayName} `;
  if (lastAtIdx < 0) {
    return `${text}${insertText}`;
  }
  const before = text.slice(0, lastAtIdx);
  const after = text.slice(lastAtIdx + 1);
  const partialAfter = after.trim();
  if (!partialAfter || displayName.toLowerCase().startsWith(partialAfter.toLowerCase())) {
    return before + insertText;
  }
  return text + insertText;
}

export function ChatGroupComposer(props: {
  selectedGroupId: string;
  onSendMessage: (content: string) => Promise<void>;
  isSending: boolean;
  agentParticipants?: readonly GroupParticipantDto[];
}) {
  const { selectedGroupId, onSendMessage, isSending, agentParticipants } = props;
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const agentOptions: AgentMentionOption[] = useMemo(
    () =>
      (agentParticipants || [])
        .filter((p): p is GroupParticipantDto & { type: 'agent' } => p.type === 'agent')
        .map((p) => ({
          accountId: String(p.accountId || ''),
          displayName: String(p.displayName || p.handle || '').trim(),
        }))
        .filter((a) => a.accountId && a.displayName),
    [agentParticipants],
  );

  const focusTextarea = useCallback(() => {
    rootRef.current?.querySelector<HTMLTextAreaElement>('[data-chat-composer-textarea="true"]')?.focus();
  }, []);

  const submitAdapter = useMemo(() => ({
    submit: async (input: { text: string }) => {
      const trimmed = input.text.trim();
      if (!selectedGroupId || !trimmed || isSending) {
        return;
      }
      await onSendMessage(trimmed);
      setMentionOpen(false);
    },
  }), [isSending, onSendMessage, selectedGroupId]);

  const handleTextChange = useCallback((newText: string) => {
    setText(newText);
    const cursor = rootRef.current
      ?.querySelector<HTMLTextAreaElement>('[data-chat-composer-textarea="true"]')
      ?.selectionStart;
    if (agentOptions.length > 0 && shouldOpenGroupAgentMentionPicker(newText, cursor)) {
      setMentionOpen(true);
      return;
    }
    if (!newText.includes('@')) {
      setMentionOpen(false);
    }
  }, [agentOptions.length]);

  const handleInsertMention = useCallback((agent: AgentMentionOption) => {
    setText(applyGroupAgentMentionSelection(text, agent.displayName));
    setMentionOpen(false);
    focusTextarea();
  }, [focusTextarea, text]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      data-chat-composer-layout="stacked"
      data-chat-group-composer-layout="stacked"
      data-chat-group-mention-posture="text-insertion-only"
    >
      {mentionOpen && agentOptions.length > 0 && (
        <div className="absolute bottom-full left-5 right-5 mb-1 rounded-lg border border-violet-200/80 bg-white shadow-lg">
          <div className="px-2 py-1.5 text-[11px] font-medium text-slate-400">
            {t('Chat.groupMentionAgent', { defaultValue: 'Mention an agent' })}
          </div>
          {agentOptions.map((agent) => (
            <button
              key={agent.accountId}
              type="button"
              onClick={() => handleInsertMention(agent)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-violet-50"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-medium text-violet-600">
                {agent.displayName.charAt(0).toUpperCase()}
              </div>
              <span>@{agent.displayName}</span>
            </button>
          ))}
        </div>
      )}
      <CanonicalComposer
        adapter={submitAdapter}
        text={text}
        onTextChange={handleTextChange}
        disabled={!selectedGroupId || isSending}
        placeholder={agentOptions.length > 0
          ? t('Chat.groupComposerWithAgents', { defaultValue: 'Type a message... Use @ to mention an agent' })
          : t('TurnInput.typeMessage', { defaultValue: 'Type a message...' })}
        layout="stacked"
        widthClassName={CHAT_CONTENT_WIDTH_CLASS}
        widthPositionClassName={CHAT_CONTENT_POSITION_CLASS}
      />
    </div>
  );
}
