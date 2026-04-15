import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RealmModel } from '@nimiplatform/sdk/realm';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;

type AgentMentionOption = {
  accountId: string;
  displayName: string;
};

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
    // Open mention popover when user types '@' at end or after a space
    if (agentOptions.length > 0) {
      const cursor = e.target.selectionStart ?? newText.length;
      const charBefore = newText[cursor - 1];
      const charTwoBefore = cursor >= 2 ? newText[cursor - 2] : ' ';
      if (charBefore === '@' && (!charTwoBefore || /\s/.test(charTwoBefore))) {
        setMentionOpen(true);
      }
    }
  }, [agentOptions.length]);

  const handleInsertMention = useCallback((agent: AgentMentionOption) => {
    // Replace the trailing '@' with '@DisplayName '
    const lastAtIdx = text.lastIndexOf('@');
    if (lastAtIdx >= 0) {
      const before = text.slice(0, lastAtIdx);
      const after = text.slice(lastAtIdx + 1);
      // Only replace if the @ is the trigger (no partial name typed yet or partial matches)
      const partialAfter = after.trim();
      const insertText = `@${agent.displayName} `;
      if (!partialAfter || agent.displayName.toLowerCase().startsWith(partialAfter.toLowerCase())) {
        setText(before + insertText);
      } else {
        setText(text + `@${agent.displayName} `);
      }
    } else {
      setText(text + `@${agent.displayName} `);
    }
    setMentionOpen(false);
    textareaRef.current?.focus();
  }, [text]);

  return (
    <div className="relative border-t border-slate-200/60 bg-white/90 px-4 py-3">
      {mentionOpen && agentOptions.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-1 rounded-lg border border-violet-200/80 bg-white shadow-lg">
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
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          className="min-h-[38px] max-h-[120px] flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
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
        />
        <button
          type="button"
          disabled={!text.trim() || isSending}
          onClick={() => void handleSubmit()}
          className="inline-flex h-[38px] items-center justify-center rounded-lg bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSending
            ? t('Chat.sending', { defaultValue: 'Sending...' })
            : t('Chat.send', { defaultValue: 'Send' })}
        </button>
      </div>
    </div>
  );
}
