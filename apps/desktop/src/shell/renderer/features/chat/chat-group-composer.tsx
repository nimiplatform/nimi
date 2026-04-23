import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { ConversationComposerShell } from '@nimiplatform/nimi-kit/features/chat';
import { useTranslation } from 'react-i18next';
import type { RealmModel } from '@nimiplatform/sdk/realm';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;

type AgentMentionOption = {
  accountId: string;
  displayName: string;
};

const MIN_TEXTAREA_HEIGHT = 48;
const MAX_TEXTAREA_HEIGHT = 128;

const ICON_SEND = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

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
  const { onSendMessage, isSending, agentParticipants } = props;
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastHeightRef = useRef(MIN_TEXTAREA_HEIGHT);

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

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setText('');
    setMentionOpen(false);
    await onSendMessage(trimmed);
  }, [text, isSending, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
    if (e.key === 'Escape' && mentionOpen) {
      setMentionOpen(false);
    }
  }, [handleSubmit, mentionOpen]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    if (agentOptions.length > 0 && shouldOpenGroupAgentMentionPicker(newText, e.target.selectionStart)) {
      setMentionOpen(true);
    }
  }, [agentOptions.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);
    lastHeightRef.current = nextHeight;
    textarea.style.height = `${nextHeight}px`;
  }, [text]);

  const handleInsertMention = useCallback((agent: AgentMentionOption) => {
    setText(applyGroupAgentMentionSelection(text, agent.displayName));
    setMentionOpen(false);
    textareaRef.current?.focus();
  }, [text]);

  return (
    <div
      className="relative shrink-0 px-5 pb-5 pt-2"
      data-chat-composer-layout="stacked"
      data-chat-group-composer-layout="stacked"
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
      <ConversationComposerShell className="rounded-[24px] shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3">
        <div data-chat-composer-textarea-row="true">
          <textarea
            ref={textareaRef}
            data-chat-composer-textarea="true"
            className="min-h-[48px] max-h-32 w-full resize-none overflow-y-hidden rounded-[24px] border-0 bg-transparent px-4 py-3.5 text-[15px] leading-6 text-slate-700 outline-none transition placeholder:text-slate-400 focus:ring-0 disabled:bg-transparent"
            placeholder={
              agentOptions.length > 0
                ? t('Chat.groupComposerWithAgents', { defaultValue: 'Type a message... Use @ to mention an agent' })
                : t('TurnInput.typeMessage', { defaultValue: 'Type a message...' })
            }
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isSending}
            style={{ height: `${lastHeightRef.current}px` }}
          />
        </div>
        <div
          className="flex items-center gap-3 px-1"
          data-chat-composer-toolbar="true"
          data-chat-group-composer-toolbar="true"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5" data-chat-composer-toolbar-leading="true" />
          <div className="ml-auto flex shrink-0 items-center justify-end" data-chat-composer-toolbar-trailing="true">
            <button
              type="button"
              disabled={!text.trim() || isSending}
              aria-label={t('Chat.send', { defaultValue: 'Send' })}
              data-chat-composer-send="true"
              onClick={() => void handleSubmit()}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-500 text-white transition-all duration-150',
                'shadow-[0_8px_20px_rgba(100,116,139,0.22)] hover:bg-slate-600 hover:shadow-[0_12px_24px_rgba(100,116,139,0.28)]',
                'active:scale-[0.92]',
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-slate-500',
              )}
            >
              <span className="scale-[0.88]">{ICON_SEND}</span>
            </button>
          </div>
        </div>
      </div>
      </ConversationComposerShell>
    </div>
  );
}
