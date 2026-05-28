import { cn } from '@nimiplatform/kit/ui';
import type { ConversationThreadSummary } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { ChatSideSheet } from './chat-shared-side-sheet';

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay < 7) return `${diffDay}d`;
  if (diffWeek < 5) return `${diffWeek}w`;
  return `${diffMonth}mo`;
}

export type ChatNimiThreadListSheetProps = {
  threads: readonly ConversationThreadSummary[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread?: () => void;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  description?: string | null;
};

function SessionThreadItem({
  thread,
  active,
  onSelect,
}: {
  thread: ConversationThreadSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DesktopCardSurface
      kind="operational-solid"
      as="div"
      className={cn(
        'group relative overflow-hidden transition-colors duration-100',
        active
          ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,white)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_98%,white)]'
          : 'border-transparent bg-[color-mix(in_srgb,var(--nimi-surface-card)_74%,white)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]',
      )}
    >
      <button type="button" className="w-full px-3 py-2.5 text-left" onClick={onSelect}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'truncate text-[13px]',
                active ? 'font-semibold text-slate-900' : 'font-medium text-slate-700',
              )}
            >
              {thread.title}
            </p>
          </div>
          <div className="shrink-0 pt-0.5 pr-1 text-[10px] text-slate-400">
            {formatRelativeTime(thread.updatedAt)}
          </div>
        </div>
      </button>
    </DesktopCardSurface>
  );
}

export function ChatNimiThreadListSheet(props: ChatNimiThreadListSheetProps) {
  const { t } = useTranslation();

  return (
    <ChatSideSheet
      sheetKey="nimi-thread-list"
      title={props.title}
      subtitle={props.subtitle || t('Chat.nimiModeSubtitle', { defaultValue: 'Nimi threads and summaries' })}
      onClose={props.onClose}
      footer={(
        <DesktopCompactAction
          tone="primary"
          fullWidth
          onClick={props.onCreateThread}
          disabled={!props.onCreateThread}
          className="gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t('Chat.newConversation', { defaultValue: 'New conversation' })}
        </DesktopCompactAction>
      )}
    >
      <div className="px-4 py-4">
        <p className="text-xs leading-5 text-slate-500">
          {props.description || t('Chat.nimiTranscriptEmpty', { defaultValue: 'Send a message to start this conversation.' })}
        </p>
      </div>
      {props.threads.length === 0 ? (
        <div className="flex min-h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-500">{t('Chat.noConversationsYet', { defaultValue: 'No conversations yet' })}</p>
          <p className="text-xs text-slate-400">{t('Chat.startNewConversation', { defaultValue: 'Start a new conversation above' })}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 px-3 py-3">
          {props.threads.map((thread) => (
            <SessionThreadItem
              key={thread.id}
              thread={thread}
              active={thread.id === props.activeThreadId}
              onSelect={() => props.onSelectThread(thread.id)}
            />
          ))}
        </div>
      )}
    </ChatSideSheet>
  );
}
