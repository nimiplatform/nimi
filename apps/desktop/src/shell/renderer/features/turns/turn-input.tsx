import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';

export function TurnInput() {
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [text, setText] = useState('');
  const context = useUiExtensionContext();

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedChatId) {
        throw new Error(t('TurnInput.selectChatFirst'));
      }
      const content = text.trim();
      if (!content) {
        throw new Error(t('TurnInput.inputMessageRequired'));
      }
      await dataSync.sendMessage(selectedChatId, content);
      return content;
    },
    onSuccess: async () => {
      setText('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', selectedChatId] }),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
      ]);
    },
    onError: (error) => {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('TurnInput.sendFailed'),
      });
    },
  });

  return (
    <section className="border-t border-gray-200 bg-white px-5 pb-4 pt-2">
      {/* Toolbar row — WeChat-like quick actions + extension slot */}
      <div className="mb-1.5 flex items-center gap-1">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]"
          aria-label={t('TurnInput.emoji')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>

        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]"
          aria-label={t('TurnInput.components')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
            <path d="M12 2v20" />
            <path d="M4 6.5l8 4.5 8-4.5" />
          </svg>
        </button>

        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]"
          aria-label={t('TurnInput.files')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11z" />
          </svg>
        </button>

        <button
          type="button"
          className="flex h-8 items-center justify-center gap-0.5 rounded px-1 text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]"
          aria-label={t('TurnInput.moreTools')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3v14" />
            <path d="M15 3v14" />
            <path d="M4 8h16" />
            <path d="M4 13h16" />
            <path d="M9 17l-2 4" />
            <path d="M15 17l2 4" />
          </svg>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {flags.enableModUi ? (
          <SlotHost slot="chat.turn.input.toolbar" base={null} context={context} />
        ) : null}
      </div>

      {/* Input area — Enter send / Shift+Enter newline */}
      <div className="min-h-[108px] px-1 pt-1">
        <textarea
          className="min-h-[96px] w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 text-[#1f2937] outline-none placeholder:text-[#9ca3af]"
          rows={4}
          placeholder={selectedChatId ? '' : t('TurnInput.selectChatFirst')}
          value={text}
          disabled={!selectedChatId || sendMutation.isPending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) {
              return;
            }
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            event.preventDefault();
            if (text.trim() && selectedChatId && !sendMutation.isPending) {
              sendMutation.mutate();
            }
          }}
        />
      </div>
    </section>
  );
}
