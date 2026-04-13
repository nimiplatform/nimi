import { useCallback } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';

type ChatAgentHistoryPanelProps = {
  targetTitle: string;
  activeThreadId: string | null;
  disabled?: boolean;
  onClearAgentHistory: (threadId: string) => void | Promise<void>;
};

export function ChatAgentHistoryPanel(props: ChatAgentHistoryPanelProps) {
  const { t } = useTranslation();

  const handleClearAgentHistory = useCallback(() => {
    void (async () => {
      if (!props.activeThreadId) {
        return;
      }
      const confirmation = await confirmDialog({
        title: t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' }),
        description: t('Chat.clearAgentChatHistoryConfirm', {
          defaultValue: 'Clear all local chat history with {{name}}? This cannot be undone.',
          name: props.targetTitle,
        }),
        level: 'warning',
      });
      if (!confirmation.confirmed) {
        return;
      }
      await props.onClearAgentHistory(props.activeThreadId);
    })().catch(() => {
      // Host action error handling lives upstream; swallow confirm failures here to avoid unhandled rejections.
    });
  }, [props, t]);

  return (
    <div className="shrink-0">
      <section className="rounded-3xl border border-red-200/70 bg-white/78 px-4 py-4 text-left shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-red-500">
          {t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' })}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {t('Chat.clearAgentChatHistoryHint', {
            defaultValue: 'Delete every local chat record with this agent on this device.',
          })}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={props.disabled || !props.activeThreadId}
            onClick={handleClearAgentHistory}
            className={cn(
              'inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
              'border-red-300 bg-red-500 text-white hover:bg-red-600',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {t('Chat.clearAgentChatHistoryAction', { defaultValue: 'Clear agent chat history' })}
          </button>
        </div>
      </section>
    </div>
  );
}
