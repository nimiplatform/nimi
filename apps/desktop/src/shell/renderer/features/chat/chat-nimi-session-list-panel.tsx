import { AppCardSurface, cn, CompactAction, EmptyState } from '@nimiplatform/kit/ui';
import type { ConversationThreadSummary } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { ChatSideSheet } from './chat-shared-side-sheet';

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
  const i18n = useDesktopI18nResource();
  return (
    <AppCardSurface
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
                active ? 'font-semibold text-[var(--nimi-text-primary)]' : 'font-medium text-[var(--nimi-text-secondary)]',
              )}
            >
              {thread.title}
            </p>
          </div>
          <div className="shrink-0 pt-0.5 pr-1 text-[10px] text-[var(--nimi-text-muted)]">
            {i18n.formatRelativeTime(thread.updatedAt)}
          </div>
        </div>
      </button>
    </AppCardSurface>
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
        <CompactAction
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
        </CompactAction>
      )}
    >
      <div className="px-4 py-4">
        <p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">
          {props.description || t('Chat.nimiTranscriptEmpty', { defaultValue: 'Send a message to start this conversation.' })}
        </p>
      </div>
      {props.threads.length === 0 ? (
        <EmptyState
          className="mx-4 my-4"
          icon={(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
          title={t('Chat.noConversationsYet', { defaultValue: 'No conversations yet' })}
          description={t('Chat.startNewConversation', { defaultValue: 'Start a new conversation above' })}
        />
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
