import { cn } from '@nimiplatform/nimi-kit/ui';
import { ConversationThreadList } from '@nimiplatform/nimi-kit/features/chat';
import type { ConversationThreadSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { RightPanelHeader } from './chat-right-panel-character-rail';

// ---------------------------------------------------------------------------
// AI Session List — right panel for AI mode
// ---------------------------------------------------------------------------

export type ChatAiSessionListPanelProps = {
  threads: readonly ConversationThreadSummary[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread?: () => void;
  routeLabel?: string | null;
  onToggleSettings: () => void;
  settingsActive: boolean;
};

export function ChatAiSessionListPanel(props: ChatAiSessionListPanelProps) {
  const { t } = useTranslation();
  return (
    <aside
      className="relative flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-l border-white/70 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
      data-right-panel="session-list"
    >
      <RightPanelHeader onToggleSettings={props.onToggleSettings} settingsActive={props.settingsActive} />

      {/* New conversation button */}
      <div className="shrink-0 px-3 pt-2 pb-1">
        <button
          type="button"
          onClick={props.onCreateThread}
          disabled={!props.onCreateThread}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200/60 bg-emerald-50/60 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors',
            'hover:bg-emerald-100/60 active:bg-emerald-100',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t('Chat.newConversation', { defaultValue: 'New conversation' })}
        </button>
      </div>

      {/* Thread list */}
      <ConversationThreadList
        threads={props.threads as ConversationThreadSummary[]}
        activeThreadId={props.activeThreadId}
        onSelectThread={props.onSelectThread}
        className="px-1.5"
        emptyState={
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-sm font-medium text-slate-500">{t('Chat.noConversationsYet', { defaultValue: 'No conversations yet' })}</p>
            <p className="text-xs text-slate-400">{t('Chat.startNewConversation', { defaultValue: 'Start a new conversation above' })}</p>
          </div>
        }
      />

      {/* Route/model info at bottom */}
      {props.routeLabel ? (
        <div className="shrink-0 border-t border-slate-200/60 px-3 py-2">
          <p className="truncate text-[11px] font-medium text-slate-400" title={props.routeLabel}>
            {props.routeLabel}
          </p>
        </div>
      ) : null}
    </aside>
  );
}
