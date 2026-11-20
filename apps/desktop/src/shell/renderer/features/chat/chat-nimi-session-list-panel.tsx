import { AppCardSurface, cn, CompactAction, EmptyState } from '@nimiplatform/kit/ui';
import type { ConversationThreadSummary } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { ChatSideSheet } from './chat-shared-side-sheet';

export type ChatNimiThreadListSheetProps = {
  saveForHarness?: () => boolean;
  historyError: string | null;
  loadingHistory: boolean;
  retryHistory: () => void;
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
        'desktop-sidebar__row-surface group relative overflow-hidden transition-colors duration-100',
        active
          ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,white)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_98%,white)]'
          : 'border-transparent bg-[color-mix(in_srgb,var(--nimi-surface-card)_74%,white)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]',
      )}
    >
      <button type="button" className="desktop-sidebar__row w-full text-left" onClick={onSelect}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'desktop-sidebar__label',
                active ? 'font-semibold text-[var(--nimi-text-primary)]' : 'font-medium text-[var(--nimi-text-secondary)]',
              )}
            >
              {thread.title}
            </p>
          </div>
          <div className="desktop-sidebar__caption shrink-0 pt-0.5 text-[var(--nimi-text-muted)]">
            {i18n.formatRelativeTime(thread.updatedAt)}
          </div>
        </div>
      </button>
    </AppCardSurface>
  );
}

export function ChatNimiThreadListSheet(props: ChatNimiThreadListSheetProps) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ id: string; text: string }>();
  const selectedId = props.activeThreadId;
  const threadCount = props.threads.length;
  const subtitle = props.subtitle
    || (threadCount > 0
      ? t('Chat.threadListCount', { count: threadCount, defaultValue: '{{count}} conversations' })
      : t('Chat.threadListSubtitle', { defaultValue: 'Conversation history' }));

  return (
    <ChatSideSheet
      sheetKey="nimi-thread-list"
      title={props.title}
      subtitle={subtitle}
      onClose={props.onClose}
      footer={(
        <div className="grid gap-2">
          {props.saveForHarness && selectedId && <div>
            <CompactAction tone="neutral" fullWidth onClick={() => {
              const saved = props.saveForHarness?.();
              setNotice({ id: selectedId, text: saved ? t('Chat.handoffSaved') : t('Chat.handoffUnavailable') });
            }}>{t('Chat.handoffSave')}</CompactAction>
            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]" role="status">{notice?.id === selectedId ? notice.text : t('Chat.handoffHint')}</p>
          </div>}
          <CompactAction
            tone="primary"
            fullWidth
            onClick={props.onCreateThread}
            disabled={!props.onCreateThread}
            className="desktop-sidebar__row"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('Chat.newConversation', { defaultValue: 'New conversation' })}
          </CompactAction>
        </div>
      )}
    >
      {props.description ? (
        <div className="px-6 py-4">
          <p className="text-xs leading-5 text-[var(--nimi-text-secondary)]">{props.description}</p>
        </div>
      ) : null}
      {props.historyError && <div className="mx-4 my-4 grid gap-2" role="alert">
        <p>{props.historyError}</p>
        <CompactAction tone="neutral" onClick={props.retryHistory}>{t('Chat.retryHistory')}</CompactAction>
      </div>}
      {props.loadingHistory && !props.threads.length && <p className="mx-4 my-4" role="status">{t('Chat.loadingHistory')}</p>}
      {props.threads.length === 0 && !props.historyError && !props.loadingHistory ? (
        <EmptyState
          className="mx-4 my-4"
          icon={(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
          title={t('Chat.noConversationsYet', { defaultValue: 'No conversations yet' })}
          description={t('Chat.startNewConversation', { defaultValue: 'Start a new conversation below' })}
        />
      ) : (
        <div className="desktop-sidebar__body desktop-sidebar__items">
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
